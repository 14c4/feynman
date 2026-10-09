import type { StudentReplyInput } from '../../../shared/types';

export interface StudentReasoningService {
  generateReply(input: StudentReplyInput): Promise<{ text: string }>;
}
