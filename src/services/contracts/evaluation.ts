import type { EvaluationInput, EvaluationResult } from '../../../shared/types';

export interface EvaluationService {
  evaluate(input: EvaluationInput): Promise<EvaluationResult>;
}
