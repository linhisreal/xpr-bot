/**
 * Operation types with priority levels
 */
export enum OperationType {
  DATA = 'DATA',                    // Priority 1 (highest)
  UI_UPDATE = 'UI_UPDATE',          // Priority 2
  CLEANUP = 'CLEANUP',              // Priority 3
  DELETE = 'DELETE'                 // Priority 4 (lowest - always last)
}

/**
 * Operation priority levels
 */
export enum OperationPriority {
  HIGH = 1,     // Data operations, ticket creation/updates
  MEDIUM = 2,   // UI updates, message sending
  LOW = 3,      // Cleanup operations
  CRITICAL = 4  // Delete operations - always last
}

/**
 * Interface for operation definition
 */
export interface Operation {
  id: string;
  type: OperationType;
  priority: OperationPriority;
  description: string;
  execute: () => Promise<any>;
  rollback?: () => Promise<void>;
  dependencies?: string[];
  timeout?: number;
}

/**
 * Operation execution result
 */
export interface OperationResult {
  id: string;
  success: boolean;
  result?: any;
  error?: Error;
  executionTime: number;
}

/**
 * Batch operation for grouping related operations
 */
export interface OperationBatch {
  id: string;
  description: string;
  operations: Operation[];
  rollbackOnFailure: boolean;
}

/**
 * Centralized operation queue that ensures delete operations always happen last
 */
export class OperationQueue {
  private queue: Operation[] = [];
  private executing = false;
  private completedOperations: Map<string, OperationResult> = new Map();
  // private readonly maxRetries = 3;
  private readonly defaultTimeout = 30000; // 30 seconds

  /**
   * Add an operation to the queue
   */
  enqueue(operation: Operation): void {
    // Validate that delete operations have the correct priority
    if (operation.type === OperationType.DELETE && operation.priority !== OperationPriority.CRITICAL) {
      console.warn(`Delete operation ${operation.id} should have CRITICAL priority, adjusting`);
      operation.priority = OperationPriority.CRITICAL;
    }

    this.queue.push(operation);
    console.log(`Operation queued: ${operation.id} (${operation.type}, priority ${operation.priority})`);
  }

  /**
   * Add a batch of operations to the queue
   */
  enqueueBatch(batch: OperationBatch): void {
    console.log(`Enqueueing batch: ${batch.id} with ${batch.operations.length} operations`);
    
    for (const operation of batch.operations) {
      this.enqueue(operation);
    }
  }

  /**
   * Process all operations in priority order
   */
  async processQueue(): Promise<OperationResult[]> {
    if (this.executing) {
      console.log('Queue already processing, skipping');
      return [];
    }

    this.executing = true;
    const results: OperationResult[] = [];

    try {
      // Sort operations by priority (lower number = higher priority)
      const sortedOperations = [...this.queue].sort((a, b) => {
        if (a.priority !== b.priority) {
          return a.priority - b.priority;
        }
        // Within same priority, maintain insertion order
        return this.queue.indexOf(a) - this.queue.indexOf(b);
      });

      console.log(`Processing ${sortedOperations.length} operations in priority order`);

      for (const operation of sortedOperations) {
        const result = await this.executeOperation(operation);
        results.push(result);

        if (!result.success) {
          console.error(`Operation ${operation.id} failed:`, result.error?.message);
          
          // Stop processing if a high-priority operation fails
          if (operation.priority <= OperationPriority.MEDIUM) {
            console.log('High-priority operation failed, stopping queue processing');
            await this.rollbackOperations(results.filter(r => r.success));
            break;
          }
        }
      }

      // Clear the queue after processing
      this.queue = [];
    } finally {
      this.executing = false;
    }

    return results;
  }

  /**
   * Execute a single operation with timeout and retry logic
   */
  private async executeOperation(operation: Operation): Promise<OperationResult> {
    const startTime = Date.now();
    const timeout = operation.timeout || this.defaultTimeout;

    try {
      console.log(`Executing operation: ${operation.id} (${operation.description})`);
      
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`Operation timed out after ${timeout}ms`)), timeout);
      });

      const result = await Promise.race([
        operation.execute(),
        timeoutPromise
      ]);

      const executionTime = Date.now() - startTime;
      const operationResult: OperationResult = {
        id: operation.id,
        success: true,
        result,
        executionTime
      };

      this.completedOperations.set(operation.id, operationResult);
      console.log(`Operation ${operation.id} completed successfully in ${executionTime}ms`);
      
      return operationResult;
    } catch (error) {
      const executionTime = Date.now() - startTime;
      const operationResult: OperationResult = {
        id: operation.id,
        success: false,
        error: error as Error,
        executionTime
      };

      this.completedOperations.set(operation.id, operationResult);
      console.error(`Operation ${operation.id} failed after ${executionTime}ms:`, error);
      
      return operationResult;
    }
  }

  /**
   * Rollback completed operations in reverse order
   */
  private async rollbackOperations(successfulResults: OperationResult[]): Promise<void> {
    console.log(`Rolling back ${successfulResults.length} operations`);
    
    // Rollback in reverse order
    for (let i = successfulResults.length - 1; i >= 0; i--) {
      const result = successfulResults[i];
      const operation = this.queue.find(op => op.id === result.id);
      
      if (operation?.rollback) {
        try {
          console.log(`Rolling back operation: ${operation.id}`);
          await operation.rollback();
        } catch (error) {
          console.error(`Rollback failed for operation ${operation.id}:`, error);
        }
      }
    }
  }

  /**
   * Create a simple operation
   */
  static createOperation(
    id: string,
    type: OperationType,
    description: string,
    execute: () => Promise<any>,
    rollback?: () => Promise<void>
  ): Operation {
    const priority = OperationQueue.getPriorityForType(type);
    
    return {
      id,
      type,
      priority,
      description,
      execute,
      rollback
    };
  }

  /**
   * Get appropriate priority for operation type
   */
  private static getPriorityForType(type: OperationType): OperationPriority {
    switch (type) {
      case OperationType.DATA:
        return OperationPriority.HIGH;
      case OperationType.UI_UPDATE:
        return OperationPriority.MEDIUM;
      case OperationType.CLEANUP:
        return OperationPriority.LOW;
      case OperationType.DELETE:
        return OperationPriority.CRITICAL;
      default:
        return OperationPriority.MEDIUM;
    }
  }

  /**
   * Check if queue is currently processing
   */
  isProcessing(): boolean {
    return this.executing;
  }

  /**
   * Get queue status
   */
  getStatus(): { queueLength: number; executing: boolean; completedCount: number } {
    return {
      queueLength: this.queue.length,
      executing: this.executing,
      completedCount: this.completedOperations.size
    };
  }

  /**
   * Clear the queue (use with caution)
   */
  clear(): void {
    if (this.executing) {
      console.warn('Cannot clear queue while executing operations');
      return;
    }
    
    this.queue = [];
    this.completedOperations.clear();
    console.log('Operation queue cleared');
  }
}