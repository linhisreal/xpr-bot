const fs = require('fs');
const path = require('path');

/**
 * Strip Line Comments Script
 * Removes unwanted // comments from TypeScript and JavaScript files
 * while preserving important comments like JSDoc, ESLint directives, etc.
 */

// Directory to process
const SRC_DIR = path.join(__dirname, '..', 'src');

// Statistics tracking
let filesProcessed = 0;
let totalCommentsRemoved = 0;

/**
 * Check if a comment should be preserved
 * @param {string} line - The line to check
 * @returns {boolean} - True if comment should be preserved
 */
function shouldPreserveComment(line) {
  // Preserve TypeScript compiler directives
  if (/^\s*\/\/\s*@ts-/i.test(line)) return true;
  
  // Preserve ESLint directives
  if (/^\s*\/\/\s*eslint/i.test(line)) return true;
  
  // Preserve TODO, FIXME, NOTE, HACK comments
  if (/^\s*\/\/\s*(TODO|FIXME|NOTE|HACK)/i.test(line)) return true;
  
  // Preserve JSDoc-style comments
  if (/^\s*\/\/.*(@param|@returns|@throws|@example|@see|@since|@deprecated)/i.test(line)) return true;
  
  // Preserve comments that look like URLs or file paths
  if (/^\s*\/\/.*((https?:\/\/|file:\/\/)|[a-zA-Z]:[\\\/])/i.test(line)) return true;
  
  // Preserve comments that are part of code examples or documentation
  if (/^\s*\/\/\s*\*/.test(line)) return true;
  
  return false;
}

/**
 * Process a single line to remove unwanted comments
 * @param {string} line - The line to process
 * @returns {object} - {processedLine, commentsRemoved, shouldRemoveLine}
 */
function processLine(line) {
  // Skip empty lines or lines without comments
  if (!line.includes('//')) {
    return { processedLine: line, commentsRemoved: 0, shouldRemoveLine: false };
  }
  
  // If this is a preserved comment line, keep it as is
  if (shouldPreserveComment(line)) {
    return { processedLine: line, commentsRemoved: 0, shouldRemoveLine: false };
  }
  
  // For inline comments, check if the comment part should be preserved
  const commentMatch = line.match(/^(.*?)\s*\/\/(.*)$/);
  if (commentMatch) {
    const beforeComment = commentMatch[1];
    const commentPart = '//' + commentMatch[2];
    
    // If the comment part should be preserved, keep the whole line
    if (shouldPreserveComment(commentPart)) {
      return { processedLine: line, commentsRemoved: 0, shouldRemoveLine: false };
    }
    
    // Remove the comment part, but keep the code part
    const trimmedCode = beforeComment.trimEnd();
    if (trimmedCode.length > 0) {
      return { processedLine: trimmedCode, commentsRemoved: 1, shouldRemoveLine: false };
    } else {
      // If only comment on the line, remove the entire line
      return { processedLine: '', commentsRemoved: 1, shouldRemoveLine: true };
    }
  }
  
  return { processedLine: line, commentsRemoved: 0, shouldRemoveLine: false };
}

/**
 * Process a single file
 * @param {string} filePath - Path to the file to process
 */
function processFile(filePath) {
  try {
    console.log(`Processing: ${path.relative(process.cwd(), filePath)}`);
    
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    
    let fileCommentsRemoved = 0;
    const processedLines = [];
    
    for (const line of lines) {
      const result = processLine(line);
      
      // Only add the line if it shouldn't be removed
      if (!result.shouldRemoveLine) {
        processedLines.push(result.processedLine);
      }
      
      fileCommentsRemoved += result.commentsRemoved;
    }
    
    // Write the processed content back to the file
    const processedContent = processedLines.join('\n');
    fs.writeFileSync(filePath, processedContent, 'utf8');
    
    if (fileCommentsRemoved > 0) {
      console.log(`  Removed ${fileCommentsRemoved} comment(s)`);
      totalCommentsRemoved += fileCommentsRemoved;
    }
    
    filesProcessed++;
  } catch (error) {
    console.error(`Error processing file ${filePath}:`, error.message);
  }
}

/**
 * Recursively find all .ts and .js files in a directory
 * @param {string} dir - Directory to search
 * @returns {string[]} - Array of file paths
 */
function findSourceFiles(dir) {
  let files = [];
  
  try {
    const entries = fs.readdirSync(dir);
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry);
      const stat = fs.statSync(fullPath);
      
      if (stat.isDirectory()) {
        // Skip node_modules and other irrelevant directories
        if (!['node_modules', '.git', 'dist', 'build'].includes(entry)) {
          files = files.concat(findSourceFiles(fullPath));
        }
      } else if (stat.isFile()) {
        // Include .ts and .js files
        if (/\.(ts|js)$/.test(entry)) {
          files.push(fullPath);
        }
      }
    }
  } catch (error) {
    console.error(`Error reading directory ${dir}:`, error.message);
  }
  
  return files;
}

/**
 * Main execution function
 */
function main() {
  console.log('🧹 Strip Line Comments Script');
  console.log('=====================================');
  console.log(`Scanning directory: ${SRC_DIR}`);
  console.log('');
  
  // Check if src directory exists
  if (!fs.existsSync(SRC_DIR)) {
    console.error(`Error: Source directory not found: ${SRC_DIR}`);
    process.exit(1);
  }
  
  // Find all source files
  const sourceFiles = findSourceFiles(SRC_DIR);
  
  if (sourceFiles.length === 0) {
    console.log('No TypeScript or JavaScript files found.');
    return;
  }
  
  console.log(`Found ${sourceFiles.length} file(s) to process`);
  console.log('');
  
  // Process each file
  for (const filePath of sourceFiles) {
    processFile(filePath);
  }
  
  // Print summary
  console.log('');
  console.log('=====================================');
  console.log('✅ Processing complete!');
  console.log(`📁 Files processed: ${filesProcessed}`);
  console.log(`🗑️  Comments removed: ${totalCommentsRemoved}`);

  if (totalCommentsRemoved > 0) {
    console.log('')
    /**
    console.log('Preserved comments include:');
    console.log('  • TypeScript directives (// @ts-*)');
    console.log('  • ESLint directives (// eslint-*)');
    console.log('  • TODO, FIXME, NOTE, HACK comments');
    console.log('  • JSDoc-style comments');
    console.log('  • URLs and file paths');
    */
  }
}

// Run the script
if (require.main === module) {
  main();
}

module.exports = { processLine, shouldPreserveComment, findSourceFiles };
