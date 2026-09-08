import { ref } from "vue";

export interface Toast {
  id: number;
  title: string;
  description?: string;
  color?: "red" | "green" | "blue" | "yellow" | "gray";
  duration?: number;
}

const toasts = ref<Toast[]>([]);
const timeouts = new Map<number, ReturnType<typeof setTimeout>>();
let nextId = 0;

export const useToast = () => {
  const add = (toast: Omit<Toast, "id">) => {
    const id = nextId++;
    const duration = toast.duration || 5000;
    const newToast: Toast = {
      id,
      ...toast,
      color: toast.color || "gray",
    };

    toasts.value.push(newToast);

    // Auto-remove after duration (tracked for cleanup)
    const timeout = setTimeout(() => {
      timeouts.delete(id);
      remove(id);
    }, duration);
    timeouts.set(id, timeout);

    return id;
  };

  const remove = (id: number) => {
    // Clear any pending timeout for this toast
    const timeout = timeouts.get(id);
    if (timeout) {
      clearTimeout(timeout);
      timeouts.delete(id);
    }

    const index = toasts.value.findIndex((t) => t.id === id);
    if (index > -1) {
      toasts.value.splice(index, 1);
    }
  };

  // Convenience methods
  const success = (title: string, description?: string, duration?: number) => {
    return add({ title, description, color: "green", duration: duration || 4000 });
  };

  const error = (title: string, description?: string, duration?: number) => {
    return add({ title, description, color: "red", duration: duration || 6000 });
  };

  const warning = (title: string, description?: string, duration?: number) => {
    return add({ title, description, color: "yellow", duration: duration || 5000 });
  };

  const info = (title: string, description?: string, duration?: number) => {
    return add({ title, description, color: "blue", duration: duration || 4000 });
  };

  // Promise-based toast for async operations
  const promise = async <T>(
    promise: Promise<T>,
    options: {
      loading: string;
      success: string | ((data: T) => string);
      error: string | ((err: unknown) => string);
    },
  ): Promise<T> => {
    const loadingId = add({
      title: options.loading,
      color: "gray",
      duration: 30000, // Long duration, will be removed manually
    });

    try {
      const result = await promise;
      remove(loadingId);
      const successMsg = typeof options.success === "function" ? options.success(result) : options.success;
      success(successMsg);
      return result;
    } catch (err) {
      remove(loadingId);
      const errorMsg = typeof options.error === "function" ? options.error(err) : options.error;
      error(errorMsg, err instanceof Error ? err.message : undefined);
      throw err;
    }
  };

  return {
    toasts,
    add,
    remove,
    success,
    error,
    warning,
    info,
    promise,
  };
};
