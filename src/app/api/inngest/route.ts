import { serve } from 'inngest/next'
import { inngest } from '@/inngest/client'
import { testFunction } from '@/inngest/functions/test-function'
import { importTest } from '@/inngest/functions/import-test'

// Debug: Try importing parseIMU with error handling
let parseIMU;
try {
  const parseIMUModule = require('@/inngest/functions/parse-imu');
  parseIMU = parseIMUModule.parseIMU;
  console.log('✅ parseIMU imported successfully');
} catch (error) {
  console.error('❌ Failed to import parseIMU:', error);
}

// Debug: Try importing parseIMUTest with error handling
let parseIMUTest;
try {
  const parseIMUTestModule = require('@/inngest/functions/parse-imu-test');
  parseIMUTest = parseIMUTestModule.parseIMUTest;
  console.log('✅ parseIMUTest imported successfully');
} catch (error) {
  console.error('❌ Failed to import parseIMUTest:', error);
}

const functions = [testFunction, importTest];
if (parseIMU) {
  functions.push(parseIMU);
  console.log('✅ parseIMU added to functions array');
} else {
  console.log('❌ parseIMU not added - import failed');
}
if (parseIMUTest) {
  functions.push(parseIMUTest);
  console.log('✅ parseIMUTest added to functions array');
} else {
  console.log('❌ parseIMUTest not added - import failed');
}

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions
})

