import { ref, computed, onMounted } from 'vue'
import zhTranslations from '../locales/zh.json'
import enTranslations from '../locales/en.json'

type Translations = typeof zhTranslations
type TranslationKey = string

const translations: Record<string, Translations> = {
  zh: zhTranslations,
  en: enTranslations
}

const currentLocale = ref<string>('zh')

export const useTranslation = () => {
  const t = (key: TranslationKey): string => {
    const keys = key.split('.')
    let value: any = translations[currentLocale.value]

    for (const k of keys) {
      if (value && typeof value === 'object' && k in value) {
        value = value[k]
      } else {
        return key // Return key if translation not found
      }
    }

    return typeof value === 'string' ? value : key
  }

  const locale = computed({
    get: () => currentLocale.value,
    set: (newLocale: string) => {
      if (translations[newLocale]) {
        currentLocale.value = newLocale
        // Save to localStorage
        if (typeof globalThis !== 'undefined' && (globalThis as any).localStorage) {
          (globalThis as any).localStorage.setItem('locale', newLocale)
        }
      }
    }
  })

  const setLocale = (newLocale: string) => {
    locale.value = newLocale
  }

  // Initialize from localStorage on client side
  // Using onMounted to avoid hydration mismatch
  onMounted(() => {
    if (typeof globalThis !== 'undefined' && (globalThis as any).localStorage) {
      const savedLocale = (globalThis as any).localStorage.getItem('locale')
      if (savedLocale && translations[savedLocale]) {
        currentLocale.value = savedLocale
      }
    }
  })

  return {
    t,
    locale,
    setLocale
  }
}
