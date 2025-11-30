<script lang="ts">
  const versions = window.electron.process.versions
</script>

<ul
  class="fixed bottom-[30px] mx-auto py-[15px] px-0 font-mono flex items-center overflow-hidden rounded-[22px] bg-[#202127] backdrop-blur-[24px]"
>
  <li
    class="block float-left border-r border-[var(--ev-c-gray-1)] px-5 text-sm leading-[14px] opacity-80 last:border-none"
  >
    Electron v{versions.electron}
  </li>
  <li
    class="block float-left border-r border-[var(--ev-c-gray-1)] px-5 text-sm leading-[14px] opacity-80 last:border-none"
  >
    Chromium v{versions.chrome}
  </li>
  <li
    class="block float-left border-r border-[var(--ev-c-gray-1)] px-5 text-sm leading-[14px] opacity-80 last:border-none"
  >
    Node v{versions.node}
  </li>
</ul>
