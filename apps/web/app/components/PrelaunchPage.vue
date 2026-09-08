<template>
  <main class="prelaunch-shell">
    <div class="prelaunch-clouds" aria-hidden="true"></div>
    <section class="prelaunch-card" aria-labelledby="prelaunch-title">
      <img src="/logo.png" alt="DoubleColor.fun" class="prelaunch-logo" />
      <p class="prelaunch-eyebrow">DoubleColor.fun</p>
      <h1 id="prelaunch-title">The Flap edition is launching soon</h1>
      <p class="prelaunch-chinese">全新 Flap 版本即将上线</p>
      <p class="prelaunch-copy">
        Contracts are offline while the final launch checks are completed. Wallet connections and lottery actions will
        open after the new deployment is verified.
      </p>
      <div class="prelaunch-status">
        <span aria-hidden="true"></span>
        Pre-launch checks in progress
      </div>
    </section>
  </main>
</template>

<script setup lang="ts">
useHead({
  title: "DoubleColor.fun | Launching soon",
  meta: [
    {
      name: "description",
      content: "The new DoubleColor.fun Flap edition is preparing for launch.",
    },
  ],
});
</script>

<style scoped>
.prelaunch-shell {
  min-height: 100vh;
  display: grid;
  place-items: center;
  overflow: hidden;
  position: relative;
  padding: 2rem;
  background:
    radial-gradient(circle at 50% 15%, rgba(196, 30, 58, 0.18), transparent 34rem),
    radial-gradient(circle at 50% 100%, rgba(30, 144, 255, 0.12), transparent 30rem),
    #080810;
}

.prelaunch-clouds {
  position: absolute;
  inset: 0;
  opacity: 0.14;
  background: url("/pattern-clouds.webp") center / 42rem repeat;
  mask-image: linear-gradient(to bottom, black, transparent 85%);
}

.prelaunch-card {
  width: min(42rem, 100%);
  position: relative;
  z-index: 1;
  padding: clamp(2rem, 7vw, 4.5rem);
  text-align: center;
  border: 1px solid rgba(212, 175, 55, 0.32);
  border-radius: 1.5rem;
  background: linear-gradient(145deg, rgba(30, 30, 45, 0.94), rgba(10, 10, 17, 0.98));
  box-shadow: 0 2rem 7rem rgba(0, 0, 0, 0.48);
}

.prelaunch-card::before {
  content: "";
  position: absolute;
  inset: 0.65rem;
  pointer-events: none;
  border: 1px solid rgba(212, 175, 55, 0.1);
  border-radius: 1.1rem;
}

.prelaunch-logo {
  width: 6.5rem;
  height: 6.5rem;
  margin: 0 auto 1.5rem;
  object-fit: contain;
}

.prelaunch-eyebrow {
  margin: 0 0 0.75rem;
  color: #d4af37;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
}

h1 {
  margin: 0;
  color: #f5f5f7;
  font-family: "Playfair Display", Georgia, serif;
  font-size: clamp(2.1rem, 7vw, 4rem);
  line-height: 1.05;
  text-wrap: balance;
}

.prelaunch-chinese {
  margin: 1rem 0 0;
  color: #f5d066;
  font-size: clamp(1rem, 3vw, 1.3rem);
  letter-spacing: 0.16em;
}

.prelaunch-copy {
  max-width: 32rem;
  margin: 2rem auto 0;
  color: #a1a1aa;
  font-size: 1rem;
  line-height: 1.75;
}

.prelaunch-status {
  display: inline-flex;
  align-items: center;
  gap: 0.65rem;
  margin-top: 2rem;
  padding: 0.7rem 1rem;
  color: #d4d4d8;
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.035);
  font-size: 0.82rem;
}

.prelaunch-status span {
  width: 0.55rem;
  height: 0.55rem;
  border-radius: 50%;
  background: #d4af37;
  box-shadow: 0 0 1rem rgba(212, 175, 55, 0.75);
}

@media (max-width: 480px) {
  .prelaunch-shell {
    padding: 1rem;
  }

  .prelaunch-card {
    padding: 2.5rem 1.5rem;
  }
}
</style>
