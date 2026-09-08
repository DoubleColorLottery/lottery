<template>
  <Card v-if="isAdmin" variant="default" class="border-[rgba(239,68,68,0.5)]">
    <template #header>
      <div class="flex items-center justify-between pb-3 border-b border-[rgba(239,68,68,0.3)]">
        <h2 class="text-lg md:text-xl font-bold text-[#f5f5f7] flex items-center gap-2">
          <Icon name="heroicons:cog-6-tooth" size="2xl" class="text-[#ef4444]" />
          <span>Admin Panel</span>
        </h2>
        <Badge variant="red" size="sm">Owner Only</Badge>
      </div>
    </template>

    <div class="space-y-4">
      <!-- Fund Pot -->
      <div class="p-4 bg-[#1a1a24] rounded-lg border border-[rgba(255,255,255,0.08)]">
        <label class="text-sm font-medium text-[#a1a1aa] mb-2 block">Add to Pot (BNB)</label>
        <div class="flex gap-2">
          <input
            v-model="fundAmount"
            type="number"
            step="0.01"
            min="0"
            placeholder="0.1"
            class="flex-1 px-3 py-2 border border-[rgba(255,255,255,0.15)] rounded-lg bg-[#111118] text-[#f5f5f7] text-sm focus:border-[#d4af37] focus:outline-none"
          />
          <Button @click="handleFundPot" :loading="funding" variant="gold" size="sm"> Fund Pot </Button>
        </div>
      </div>

      <!-- Lottery Controls -->
      <div class="p-4 bg-[#1a1a24] rounded-lg border border-[rgba(255,255,255,0.08)]">
        <label class="text-sm font-medium text-[#a1a1aa] mb-3 block">Lottery Controls</label>
        <div class="grid grid-cols-2 gap-2">
          <Button
            @click="handleToggleLottery(true)"
            :loading="togglingLottery"
            :disabled="lotteryEnabled"
            variant="green"
            size="sm"
          >
            Enable Lottery
          </Button>
          <Button
            @click="handleToggleLottery(false)"
            :loading="togglingLottery"
            :disabled="!lotteryEnabled"
            variant="red"
            size="sm"
          >
            Disable Lottery
          </Button>
        </div>
      </div>

      <!-- Set Interval -->
      <div class="p-4 bg-[#1a1a24] rounded-lg border border-[rgba(255,255,255,0.08)]">
        <label class="text-sm font-medium text-[#a1a1aa] mb-2 block">Lottery Interval (blocks)</label>
        <div class="flex gap-2">
          <input
            v-model="newInterval"
            type="number"
            min="200"
            placeholder="4800"
            class="flex-1 px-3 py-2 border border-[rgba(255,255,255,0.15)] rounded-lg bg-[#111118] text-[#f5f5f7] text-sm focus:border-[#d4af37] focus:outline-none"
          />
          <Button @click="handleSetInterval" :loading="settingInterval" variant="outline" size="sm"> Set </Button>
        </div>
        <p class="text-xs text-[#71717a] mt-1">
          Current: {{ lotteryInterval }} blocks (~{{ Math.round((Number(lotteryInterval) * 0.75) / 60) }} min)
        </p>
      </div>

      <!-- Sync Flap tax revenue -->
      <div class="p-4 bg-[#1a1a24] rounded-lg border border-[rgba(212,175,55,0.25)]">
        <div class="flex items-start justify-between gap-3">
          <div>
            <label class="text-sm font-medium text-[#d4af37] mb-1 block">Sync Flap Tax Revenue</label>
            <p class="text-xs text-[#a1a1aa]">Pending revenue: {{ pendingFeeBnb }} BNB</p>
          </div>
          <Button @click="handleSyncFees" :loading="syncingFees" :disabled="!feeSyncNeeded" variant="gold" size="sm">
            Sync Fees
          </Button>
        </div>
        <p class="text-xs text-[#71717a] mt-2">
          {{ feeSyncNeeded ? "Pending fees are ready to forward into the lottery pot." : "No fee sync needed right now." }}
        </p>
        <p class="text-xs text-[#71717a] mt-1">Current pot: {{ potInBNB }} BNB</p>
      </div>

      <!-- Emergency Stop -->
      <div class="p-4 bg-[rgba(239,68,68,0.1)] rounded-lg border border-[rgba(239,68,68,0.3)]">
        <Button @click="handleEmergencyStop" :loading="stopping" :disabled="!lotteryInProgress" variant="red" block>
          Emergency Stop Lottery
        </Button>
        <p class="text-xs text-[#ef4444] mt-2 text-center">Only use if VRF callback is stuck</p>
      </div>
    </div>
  </Card>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { formatEther, parseEther } from "viem";
import { useWeb3 } from "../../composables/useWeb3";
import { useLottery } from "../../composables/useLottery";
import { LOTTERY_CONTRACT } from "../../config/contracts";
import { useToast } from "../../composables/useToast";
import { getWalletErrorMessage } from "../../composables/useWalletErrorMessage";
import { waitForSuccessfulReceipt } from "../../utils/walletReceipts";
import Button from "./ui/Button.vue";
import Card from "./ui/Card.vue";
import Badge from "./ui/Badge.vue";

const { account, walletClient, publicClient } = useWeb3();
const {
  lotteryEnabled,
  lotteryInterval,
  potInBNB,
  fetchLotteryState,
  getTokenFeeStatus,
  syncFeesToPot,
} = useLottery();
const toast = useToast();

const ownerAddress = ref("");

// Check if current user is admin
const isAdmin = computed(() => {
  return !!ownerAddress.value && account.value?.toLowerCase() === ownerAddress.value;
});

// Check if lottery is in progress
const lotteryInProgress = ref(false);

// Form state
const fundAmount = ref("");
const newInterval = ref("");
const pendingFeeEth = ref(0n);

// Loading states
const funding = ref(false);
const togglingLottery = ref(false);
const settingInterval = ref(false);
const syncingFees = ref(false);
const stopping = ref(false);

const loadOwners = async () => {
  if (!publicClient.value || !account.value) {
    ownerAddress.value = "";
    return;
  }

  try {
    const lotteryOwner = (await publicClient.value.readContract({
      ...LOTTERY_CONTRACT,
      functionName: "owner",
    })) as string;
    ownerAddress.value = lotteryOwner.toLowerCase();
  } catch {
    ownerAddress.value = "";
  }
};

const pendingFeeBnb = computed(() => Number(formatEther(pendingFeeEth.value)).toFixed(6));
const feeSyncNeeded = computed(() => pendingFeeEth.value > 0n);

const loadFeeStatus = async () => {
  try {
    const status = await getTokenFeeStatus();
    if (!status) return;
    pendingFeeEth.value = status.pendingEth;
  } catch {
    pendingFeeEth.value = 0n;
  }
};

const refreshAdminState = async () => {
  if (!publicClient.value || !account.value) {
    ownerAddress.value = "";
    lotteryInProgress.value = false;
    pendingFeeEth.value = 0n;
    return;
  }

  await loadOwners();
  if (!isAdmin.value) {
    lotteryInProgress.value = false;
    pendingFeeEth.value = 0n;
    return;
  }

  await Promise.all([fetchLotteryState(), checkLotteryProgress(), loadFeeStatus()]);
};

// Fund pot
const handleFundPot = async () => {
  if (!walletClient.value || !publicClient.value || !account.value || !fundAmount.value) return;

  try {
    funding.value = true;
    const amount = parseEther(String(fundAmount.value));

    const hash = await walletClient.value.writeContract({
      ...LOTTERY_CONTRACT,
      functionName: "fundPot",
      account: account.value,
      value: amount,
    });

    await waitForSuccessfulReceipt(publicClient.value, hash, "Fund pot");
    toast.add({ title: "Pot Funded", description: `Added ${fundAmount.value} BNB`, color: "green" });
    fundAmount.value = "";
    await refreshAdminState();
  } catch (error: any) {
    toast.add({
      title: "Fund Failed",
      description: getWalletErrorMessage(error, {
        rejectedMessage: "Transaction request was rejected",
        fallbackMessage: "Transaction failed",
      }),
      color: "red",
    });
  } finally {
    funding.value = false;
  }
};

// Toggle lottery enabled
const handleToggleLottery = async (enable: boolean) => {
  if (!walletClient.value || !publicClient.value || !account.value) return;

  try {
    togglingLottery.value = true;

    const hash = await walletClient.value.writeContract({
      ...LOTTERY_CONTRACT,
      functionName: "setLotteryEnabled",
      args: [enable],
      account: account.value,
    });

    await waitForSuccessfulReceipt(publicClient.value, hash, enable ? "Enable lottery" : "Disable lottery");
    toast.add({
      title: enable ? "Lottery Enabled" : "Lottery Disabled",
      description: "",
      color: enable ? "green" : "yellow",
    });
    await refreshAdminState();
  } catch (error: any) {
    toast.add({
      title: "Toggle Failed",
      description: getWalletErrorMessage(error, {
        rejectedMessage: "Transaction request was rejected",
        fallbackMessage: "Transaction failed",
      }),
      color: "red",
    });
  } finally {
    togglingLottery.value = false;
  }
};

// Set lottery interval
const handleSetInterval = async () => {
  if (!walletClient.value || !publicClient.value || !account.value || !newInterval.value) return;

  try {
    settingInterval.value = true;

    const hash = await walletClient.value.writeContract({
      ...LOTTERY_CONTRACT,
      functionName: "setLotteryInterval",
      args: [BigInt(newInterval.value)],
      account: account.value,
    });

    await waitForSuccessfulReceipt(publicClient.value, hash, "Set lottery interval");
    toast.add({ title: "Interval Updated", description: `Set to ${newInterval.value} blocks`, color: "green" });
    newInterval.value = "";
    await refreshAdminState();
  } catch (error: any) {
    toast.add({
      title: "Update Failed",
      description: getWalletErrorMessage(error, {
        rejectedMessage: "Transaction request was rejected",
        fallbackMessage: "Transaction failed",
      }),
      color: "red",
    });
  } finally {
    settingInterval.value = false;
  }
};

// Sync token fees into the lottery pot
const handleSyncFees = async () => {
  if (!walletClient.value || !publicClient.value || !account.value) return;

  try {
    syncingFees.value = true;
    const result = await syncFeesToPot();
    if (result.processed) {
      toast.add({ title: "Fees Synced", description: "Forwarded token fees into the pot", color: "green" });
    } else {
      toast.add({ title: "Already Synced", description: "No pending token fees to process", color: "blue" });
    }
    await refreshAdminState();
  } catch (error: any) {
    toast.add({
      title: "Fee Sync Failed",
      description: getWalletErrorMessage(error, {
        rejectedMessage: "Transaction request was rejected",
        fallbackMessage: "Transaction failed",
      }),
      color: "red",
    });
  } finally {
    syncingFees.value = false;
  }
};

// Emergency stop
const handleEmergencyStop = async () => {
  if (!walletClient.value || !publicClient.value || !account.value) return;

  try {
    stopping.value = true;

    const hash = await walletClient.value.writeContract({
      ...LOTTERY_CONTRACT,
      functionName: "emergencyStopLottery",
      account: account.value,
    });

    await waitForSuccessfulReceipt(publicClient.value, hash, "Emergency stop lottery");
    toast.add({ title: "Lottery Stopped", description: "Emergency stop executed", color: "yellow" });
    await refreshAdminState();
  } catch (error: any) {
    toast.add({
      title: "Stop Failed",
      description: getWalletErrorMessage(error, {
        rejectedMessage: "Transaction request was rejected",
        fallbackMessage: "Transaction failed",
      }),
      color: "red",
    });
  } finally {
    stopping.value = false;
  }
};

// Check lottery in progress on mount
const checkLotteryProgress = async () => {
  if (!publicClient.value) return;
  try {
    const inProgress = (await publicClient.value.readContract({
      ...LOTTERY_CONTRACT,
      functionName: "lotteryInProgress",
    })) as boolean;
    lotteryInProgress.value = inProgress;
  } catch {}
};

watch([account, publicClient], refreshAdminState, { immediate: true });
</script>
