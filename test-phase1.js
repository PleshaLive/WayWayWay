#!/usr/bin/env node

/**
 * Test script for Phase 1 - Graphics Endpoints
 * Tests /score (legacy) and /api/graphics/scoreboard (new)
 */

const http = require('http');

function testEndpoint(path) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'localhost',
      port: 2727,
      path: path,
      method: 'GET'
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          console.log(`✅ ${path}`);
          console.log(`   Status: ${res.statusCode}`);
          console.log(`   Keys: ${Object.keys(json).join(', ')}`);
          resolve(true);
        } catch (e) {
          console.log(`❌ ${path} - Invalid JSON`);
          resolve(false);
        }
      });
    });

    req.on('error', (e) => {
      console.log(`❌ ${path} - ${e.message}`);
      resolve(false);
    });

    req.end();
  });
}

async function runTests() {
  console.log('Testing Phase 1 - Graphics Endpoints\n');
  
  // Wait for server to be ready
  await new Promise(r => setTimeout(r, 2000));
  
  console.log('Testing legacy endpoint:');
  await testEndpoint('/score');
  
  console.log('\nTesting new graphics endpoint:');
  await testEndpoint('/api/graphics/scoreboard');
  
  console.log('\n✅ Test complete. You can stop the server now.');
  process.exit(0);
}

runTests().catch(console.error);
