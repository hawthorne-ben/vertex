declare module 'downsample-lttb' {
  export default function lttb(
    data: Array<[number, number]>,
    threshold: number
  ): Array<[number, number]>
}
