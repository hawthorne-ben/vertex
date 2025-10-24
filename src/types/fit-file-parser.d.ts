declare module 'fit-file-parser' {
  interface FitParserOptions {
    force?: boolean
    speedUnit?: string
    lengthUnit?: string
    temperatureUnit?: string
    pressureUnit?: string
    elapsedRecordField?: boolean
    mode?: string
  }

  interface FitData {
    sessions?: any[]
    records?: any[]
    laps?: any[]
  }

  class FitParser {
    constructor(options?: FitParserOptions)
    parse(buffer: Uint8Array, callback: (error: any, data: FitData) => void): void
  }

  export default FitParser
}
