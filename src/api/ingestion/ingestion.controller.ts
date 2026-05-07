import { Request, Response } from 'express';

export class IngestionController {
  static async trigger(req: Request, res: Response) {
    res.json({ 
      success: false, 
      message: 'Ingestion pipeline is disabled.', 
      data: {
        toolsTriggered: []
      }
    });
  }
}
