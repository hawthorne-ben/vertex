/**
 * @vertex/vtx-parser
 *
 * TypeScript encoder and decoder for VTX binary format
 */

// Export encoder and decoder
export { VTXEncoder } from './encoder';
export { VTXDecoder } from './decoder';

// Export types
export type {
  VTXHeader,
  IMURecord,
  VTXFile,
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
