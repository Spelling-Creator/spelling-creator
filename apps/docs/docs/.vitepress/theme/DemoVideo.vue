<script setup lang="ts">
// A short screen recording of the app, from docs/public/videos. Each video has
// a poster frame next to it with the same name (.jpg), shown until someone
// presses play, so a page with several videos downloads none of them up front.
//
//   <DemoVideo name="live-collaboration" title="Two practitioners editing together">
//     Optional caption.
//   </DemoVideo>
import { withBase } from "vitepress";

const props = defineProps<{ name: string; title: string }>();
const src = withBase(`/videos/${props.name}.mp4`);
const poster = withBase(`/videos/${props.name}.jpg`);
</script>

<template>
  <figure class="demo-video">
    <video
      :src="src"
      :poster="poster"
      :aria-label="title"
      controls
      muted
      playsinline
      preload="none"
    />
    <figcaption>
      <strong>{{ title }}.</strong>
      <slot />
    </figcaption>
  </figure>
</template>

<style scoped>
.demo-video {
  margin: 20px 0 24px;
}

.demo-video video {
  display: block;
  width: 100%;
  aspect-ratio: 16 / 9;
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  background: var(--vp-c-bg-soft);
}

.demo-video figcaption {
  margin-top: 8px;
  font-size: 14px;
  line-height: 1.5;
  color: var(--vp-c-text-2);
}
</style>
