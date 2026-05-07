import { Request, Response } from 'express';
import { IngestionOrchestrator } from '../../ingestion/orchestrator';
import { ProductService } from '../../services/product.service';

export class IngestionController {
  static async trigger(req: Request, res: Response) {
    // Fire and forget so we don't hold the connection open, as this process may take a while.
    setImmediate(async () => {
      const orchestrator = new IngestionOrchestrator();
      try {
        await orchestrator.run();
        await ProductService.cleanupProducts();
      } catch (err) {
        console.error(err);
      }
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
