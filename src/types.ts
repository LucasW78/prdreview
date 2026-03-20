export interface Conflict {
  id: string;
  type: 'conflict' | 'sop';
  description: string;
  ignored: boolean;
  blockId: string;
}

export interface DocBlock {
  id: string;
  originalText: string;
  aiText: string;
  hasChange: boolean;
}
