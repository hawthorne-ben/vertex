/**
 * @vertex/vtx-parser
 *
 * TypeScript encoder and decoder for VTX binary format
 */

// Export encoder, decoder, and merger
export { VTXEncoder } from './encoder';
export { VTXStreamEncoder } from './stream-encoder';
export type { WriteCallback } from './stream-encoder';
export { VTXDecoder } from './decoder';
export { VTXMerger } from './merger';
export type { MergeResult } from './merger';

// Export types
export type {
  VTXHeader,
  IMURecord,
  GPSRecord,
  VTXFile,
  VTXMetadata,
  VTXEncoderOptions,
  VTXDecoderOptions,
} from './types';

export { RecordFormatFlags } from './types';

// Export constants
export {
  VTX_FORMAT_VERSION,
  VTX_HEADER,
  VTX_RECORD_FORMAT,
  VTX_RECORD_SIZE,
  VTX_COMPRESSION,
  VTX_FOOTER,
  getRecordSize,
  getVersionString,
  hasSensor,
} from './constants';
