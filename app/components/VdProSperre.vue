<script setup lang="ts">
const props = defineProps<{ ic: string; titel: string; text: string; punkte: string[] }>()
</script>

<template>
  <div class="sperre">
    <div class="streifen" aria-hidden="true"></div>
    <span class="zeichen"
      ><Ico :n="props.ic" /><i class="schloss"><Ico n="lock" /></i
    ></span>
    <div class="was">
      <div class="eyebrow"><Ico n="krone" /> VylarisCloud Pro</div>
      <h2>{{ props.titel }}</h2>
      <p class="leise">{{ props.text }}</p>
      <ul>
        <li v-for="(p, i) in props.punkte" :key="i" :style="{ '--i': i }"><Ico n="check" /> {{ p }}</li>
      </ul>
      <NuxtLink to="/pro" class="knopf rot"><Ico n="key" /> {{ t('Lizenz aktivieren', 'Activate licence') }}</NuxtLink>
    </div>
  </div>
</template>

<style scoped>
.sperre {
  position: relative;
  overflow: hidden;
  display: flex;
  gap: 26px;
  align-items: flex-start;
  background: var(--flaeche);
  border: 1px solid var(--linie);
  border-radius: 20px;
  padding: 30px;
}
.streifen {
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(135deg, transparent 0 14px, rgba(var(--a-rgb), 0.035) 14px 15px);
  mask-image: linear-gradient(90deg, #000, transparent 70%);
  pointer-events: none;
}
.zeichen {
  position: relative;
  flex-shrink: 0;
  width: 64px;
  height: 64px;
  border-radius: 18px;
  background: rgba(var(--a-rgb), 0.1);
  color: var(--a);
  display: grid;
  place-items: center;
}
.zeichen > svg {
  width: 28px;
  height: 28px;
}
.schloss {
  position: absolute;
  right: -6px;
  bottom: -6px;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: var(--flaeche);
  border: 1px solid var(--linie);
  display: grid;
  place-items: center;
  color: var(--text2);
  animation: wackeln 3.2s 1s ease-in-out infinite;
}
.schloss svg {
  width: 13px;
  height: 13px;
}
@keyframes wackeln {
  0%,
  86%,
  100% {
    transform: rotate(0);
  }
  90% {
    transform: rotate(-12deg);
  }
  94% {
    transform: rotate(10deg);
  }
}
.was {
  position: relative;
  max-width: 560px;
}
h2 {
  font-family: var(--f-display);
  font-size: 24px;
  letter-spacing: -0.025em;
  margin-bottom: 6px;
}
p {
  margin: 0 0 14px;
}
ul {
  list-style: none;
  padding: 0;
  margin: 0 0 20px;
  display: grid;
  gap: 7px;
}
li {
  display: flex;
  gap: 9px;
  align-items: flex-start;
  font-size: 13.5px;
  animation: rein 0.5s var(--kurve) backwards;
  animation-delay: calc(0.15s + var(--i) * 60ms);
}
li svg {
  width: 15px;
  height: 15px;
  color: var(--ok);
  margin-top: 3px;
}
@media (max-width: 640px) {
  .sperre {
    flex-direction: column;
    padding: 22px;
  }
}
</style>
