declare module 'downsample-lttb' {
  export function processData(
    data: Array<[number, number]>,
    threshold: number
  ): Array<[number, number]>
}
