#!/bin/bash

# Shared deployment signer and local-secret handling. This file is sourced by
# the operator scripts; it is not intended to be executed directly.

assert_owner_only_file() {
    local file=$1
    local label=${2:-File}
    local mode
    local owner_uid
    local current_uid

    if [ -L "$file" ] || [ ! -f "$file" ]; then
        echo "Error: $label must be a regular, non-symlink file: $file" >&2
        return 1
    fi

    mode=$(stat -c '%a' -- "$file")
    owner_uid=$(stat -c '%u' -- "$file")
    current_uid=$(id -u)

    if [ "$mode" != "600" ] && [ "$mode" != "400" ]; then
        echo "Error: $label must be accessible only by its owner (chmod 600 or 400): $file" >&2
        return 1
    fi

    if [ "$owner_uid" != "$current_uid" ]; then
        echo "Error: $label must be owned by the current user: $file" >&2
        return 1
    fi
}

assert_secure_signer_file() {
    local file=$1
    local label=$2

    case "$file" in
        /*) ;;
        *)
            echo "Error: $label must use an absolute path" >&2
            return 1
            ;;
    esac

    assert_owner_only_file "$file" "$label"
}

load_secure_env_file() {
    local env_file=$1

    if [ ! -e "$env_file" ] && [ ! -L "$env_file" ]; then
        return 0
    fi

    assert_owner_only_file "$env_file" "Environment file"
    set -a
    # shellcheck disable=SC1090
    source "$env_file"
    set +a
}

load_repository_env() {
    local root_dir=$1

    if [ "${SKIP_ROOT_ENV:-0}" = "1" ]; then
        return 0
    fi

    load_secure_env_file "$root_dir/.env"
}

require_signer_value() {
    local variable_name=$1
    local value=$2

    if [ -z "$value" ]; then
        echo "Error: $variable_name is required for FOUNDRY_SIGNER_TYPE=${FOUNDRY_SIGNER_TYPE:-unset}" >&2
        return 1
    fi
}

append_signer_password_file() {
    if [ -z "${FOUNDRY_PASSWORD_FILE:-}" ]; then
        return 0
    fi

    assert_secure_signer_file "$FOUNDRY_PASSWORD_FILE" "Foundry password file"
    FOUNDRY_SIGNER_ARGS+=(--password-file "$FOUNDRY_PASSWORD_FILE")
}

discard_raw_signer_env() {
    # Raw deployment keys are intentionally ignored. The application settler
    # key remains a separate runtime concern and must never become a Forge arg.
    unset PRIVATE_KEY BSC_TESTNET_PRIVATE_KEY BSC_MAINNET_PRIVATE_KEY ETH_PRIVATE_KEY
}

configure_foundry_signer() {
    local signer_type=${FOUNDRY_SIGNER_TYPE:-}

    if [ -z "$signer_type" ]; then
        if [ -n "${FOUNDRY_ACCOUNT:-}" ]; then
            signer_type=account
        elif [ -n "${FOUNDRY_KEYSTORE:-}" ]; then
            signer_type=keystore
        fi
    fi

    if [ -z "$signer_type" ]; then
        echo "Error: configure FOUNDRY_SIGNER_TYPE as account, keystore, ledger, trezor, aws, gcp, or turnkey" >&2
        return 1
    fi

    FOUNDRY_SIGNER_TYPE=${signer_type,,}
    FOUNDRY_SIGNER_ARGS=()
    FOUNDRY_SIGNER_DESCRIPTION=""

    case "$FOUNDRY_SIGNER_TYPE" in
        account)
            require_signer_value FOUNDRY_ACCOUNT "${FOUNDRY_ACCOUNT:-}"
            FOUNDRY_SIGNER_ARGS+=(--account "$FOUNDRY_ACCOUNT")
            append_signer_password_file
            FOUNDRY_SIGNER_DESCRIPTION="Foundry account"
            ;;
        keystore)
            require_signer_value FOUNDRY_KEYSTORE "${FOUNDRY_KEYSTORE:-}"
            assert_secure_signer_file "$FOUNDRY_KEYSTORE" "Foundry keystore"
            FOUNDRY_SIGNER_ARGS+=(--keystore "$FOUNDRY_KEYSTORE")
            append_signer_password_file
            FOUNDRY_SIGNER_DESCRIPTION="Foundry keystore"
            ;;
        ledger)
            FOUNDRY_SIGNER_ARGS+=(--ledger)
            FOUNDRY_SIGNER_DESCRIPTION="Ledger"
            ;;
        trezor)
            FOUNDRY_SIGNER_ARGS+=(--trezor)
            FOUNDRY_SIGNER_DESCRIPTION="Trezor"
            ;;
        aws)
            require_signer_value AWS_KMS_KEY_ID "${AWS_KMS_KEY_ID:-}"
            FOUNDRY_SIGNER_ARGS+=(--aws)
            FOUNDRY_SIGNER_DESCRIPTION="AWS KMS"
            ;;
        gcp)
            require_signer_value GCP_PROJECT_ID "${GCP_PROJECT_ID:-}"
            require_signer_value GCP_LOCATION "${GCP_LOCATION:-}"
            require_signer_value GCP_KEY_RING "${GCP_KEY_RING:-}"
            require_signer_value GCP_KEY_NAME "${GCP_KEY_NAME:-}"
            require_signer_value GCP_KEY_VERSION "${GCP_KEY_VERSION:-}"
            FOUNDRY_SIGNER_ARGS+=(--gcp)
            FOUNDRY_SIGNER_DESCRIPTION="Google Cloud KMS"
            ;;
        turnkey)
            require_signer_value TURNKEY_API_PRIVATE_KEY "${TURNKEY_API_PRIVATE_KEY:-}"
            require_signer_value TURNKEY_ORGANIZATION_ID "${TURNKEY_ORGANIZATION_ID:-}"
            require_signer_value TURNKEY_ADDRESS "${TURNKEY_ADDRESS:-}"
            FOUNDRY_SIGNER_ARGS+=(--turnkey)
            FOUNDRY_SIGNER_DESCRIPTION="Turnkey"
            ;;
        *)
            echo "Error: unsupported FOUNDRY_SIGNER_TYPE '$FOUNDRY_SIGNER_TYPE'" >&2
            return 1
            ;;
    esac

    if [ -n "${FOUNDRY_DERIVATION_PATH:-}" ]; then
        case "$FOUNDRY_SIGNER_TYPE" in
            ledger|trezor)
                FOUNDRY_SIGNER_ARGS+=(--mnemonic-derivation-path "$FOUNDRY_DERIVATION_PATH")
                ;;
            *)
                echo "Error: FOUNDRY_DERIVATION_PATH is supported only for ledger or trezor signers" >&2
                return 1
                ;;
        esac
    fi

    discard_raw_signer_env

    FOUNDRY_SENDER_ADDRESS=${FOUNDRY_SENDER:-}
    if [ -z "$FOUNDRY_SENDER_ADDRESS" ]; then
        if [ "$FOUNDRY_SIGNER_TYPE" = "turnkey" ]; then
            FOUNDRY_SENDER_ADDRESS=$TURNKEY_ADDRESS
        else
            FOUNDRY_SENDER_ADDRESS=$(cast wallet address "${FOUNDRY_SIGNER_ARGS[@]}")
        fi
    fi

    if ! [[ "$FOUNDRY_SENDER_ADDRESS" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
        echo "Error: the configured signer did not resolve to a valid EVM address" >&2
        return 1
    fi
}

redact_rpc_from_text() {
    local text=$1
    local rpc_url=$2

    if [ -n "$rpc_url" ]; then
        text=${text//"$rpc_url"/[RPC URL hidden]}
    fi
    printf '%s\n' "$text"
}

run_with_rpc_redaction() {
    local rpc_url=${ETH_RPC_URL:-}
    local command_status
    local -a pipeline_statuses
    local restore_errexit=false

    if [ -z "$rpc_url" ]; then
        "$@"
        return
    fi

    case $- in
        *e*)
            restore_errexit=true
            set +e
            ;;
    esac

    if ! command -v perl >/dev/null 2>&1; then
        echo "Error: perl is required to redact RPC credentials from deployment output" >&2
        if [ "$restore_errexit" = "true" ]; then
            set -e
        fi
        return 1
    fi

    # Cast consumes ETH_RPC_URL. Forge maps the same config key through its
    # FOUNDRY_ environment prefix. Keep both endpoints out of process arguments.
    (
        export FOUNDRY_ETH_RPC_URL="$rpc_url"
        "$@"
    ) 2>&1 | RPC_REDACT_VALUE="$rpc_url" perl -e '
        use strict;
        use warnings;
        $| = 1;

        my $secret = $ENV{RPC_REDACT_VALUE} // q{};
        my $replacement = q{[RPC URL hidden]};
        my $buffer = q{};

        sub flush_safe_output {
            return if $buffer eq q{};
            $buffer =~ s/\Q$secret\E/$replacement/g if $secret ne q{};

            my $hold = 0;
            if ($secret ne q{}) {
                my $max = length($buffer) < length($secret) - 1
                    ? length($buffer)
                    : length($secret) - 1;
                for (my $length = $max; $length > 0; $length--) {
                    if (substr($buffer, -$length) eq substr($secret, 0, $length)) {
                        $hold = $length;
                        last;
                    }
                }
            }

            my $emit = length($buffer) - $hold;
            print substr($buffer, 0, $emit, q{}) if $emit > 0;
        }

        while (read(STDIN, my $chunk, 4096)) {
            $buffer .= $chunk;
            flush_safe_output();
        }

        $buffer =~ s/\Q$secret\E/$replacement/g if $secret ne q{};
        print $buffer;
    '
    pipeline_statuses=("${PIPESTATUS[@]}")
    command_status=${pipeline_statuses[0]}
    if [ "$command_status" -eq 0 ] && [ "${pipeline_statuses[1]}" -ne 0 ]; then
        command_status=${pipeline_statuses[1]}
    fi

    if [ "$restore_errexit" = "true" ]; then
        set -e
    fi
    return "$command_status"
}
