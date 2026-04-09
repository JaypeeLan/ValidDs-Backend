import { Request, Response } from 'express';
import { IngestionOrchestrator } from '../../ingestion/orchestrator';

export class IngestionController {
  static async trigger(req: Request, res: Response) {
    // Fire and forget so we don't hold the connection open, as this process may take a while.
    setImmediate(() => {
      const orchestrator = new IngestionOrchestrator();
      orchestrator.run().catch(console.error);
    });
    
    res.json({ 
      success: true, 
      message: 'Ingestion pipeline triggered. Processing products via EnsembleData and Extracting DeepSeek.', 
      data: {
        toolsTriggered: ['EnsembleData', 'DeepSeek']
      }
    });
  }
}
