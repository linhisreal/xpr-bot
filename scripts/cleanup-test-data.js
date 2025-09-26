#!/usr/bin/env node
/* eslint-disable no-undef */

/**
 * Cleanup script for test data files
 * Removes all test-staff-*.json files from the data directory
 */

import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function cleanupTestData() {
  const dataDir = join(__dirname, '..', 'data');
  
  try {
    const files = await fs.readdir(dataDir);
    const testFiles = files.filter(file => 
      file.startsWith('test-staff-') && file.endsWith('.json')
    );
    
    if (testFiles.length === 0) {
      console.log('✅ No test data files found to clean up.');
      return;
    }
    
    console.log(`🧹 Found ${testFiles.length} test data files to clean up...`);
    
    let cleaned = 0;
    for (const file of testFiles) {
      try {
        await fs.unlink(join(dataDir, file));
        console.log(`   Deleted: ${file}`);
        cleaned++;
      } catch (error) {
        console.warn(`   ⚠️  Failed to delete ${file}: ${error.message}`);
      }
    }
    
    console.log(`✅ Successfully cleaned up ${cleaned}/${testFiles.length} test data files.`);
    
  } catch (error) {
    console.error('❌ Error during cleanup:', error.message);
    process.exit(1);
  }
}

cleanupTestData();