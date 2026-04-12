import axios from 'axios';

const BASE_URL = 'http://localhost:3000/api/v1/jobs';
const API_KEY = 'test_api_key_32_chars_long_exactly!123'; // This needs to match env

async function test() {
  console.log('--- Testing Job Endpoints ---');

  // 1. Test GET warning
  try {
    console.log('\nTesting GET /product-refresh (should return 405)...');
    const res = await axios.get(`${BASE_URL}/product-refresh`);
    console.log('FAIL: Expected 405, got', res.status);
  } catch (err: any) {
    if (err.response?.status === 405) {
      console.log('PASS: Got 405 Method Not Allowed');
      console.log('Response body:', err.response.data);
    } else {
      console.log('FAIL: Expected 405, got', err.response?.status || err.message);
    }
  }

  // 2. Test POST with missing API Key
  try {
    console.log('\nTesting POST /product-refresh without API Key (should return 401)...');
    await axios.post(`${BASE_URL}/product-refresh`);
    console.log('FAIL: Expected 401');
  } catch (err: any) {
    console.log('RESULT: Got', err.response?.status, err.response?.data?.error?.message);
  }

  console.log('\n--- Manual Verification Complete ---');
}

test();
