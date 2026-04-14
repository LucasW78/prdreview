export interface Conflict {
  id: string;
  type: 'conflict' | 'sop';
  description: string;
  blockId: string;
}

export interface DocBlock {
  id: string;
  originalText: string;
  aiText: string;
  hasChange: boolean;
}

export interface SupplementaryInfo {
  id: string;
  blockId: string;
  title: string;
  content: string;
  source?: string;
}
