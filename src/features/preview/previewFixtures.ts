import type { AssessmentAnswer, PracticeQuestion } from '../../../shared/types';

export type PreviewScreen = 'home' | 'practice' | 'baseline' | 'conversation' | 'followup' | 'results' | 'history';
export type PreviewKind = 'baseline' | 'recheck';
export type PreviewVoiceState = 'disconnected' | 'connecting' | 'listening' | 'speaking' | 'muted' | 'error';
export interface PreviewConversationState {
  state: PreviewVoiceState;
  revealed: number;
  typed: string;
  localMessages: string[];
  showText: boolean;
}
export const initialConversationState: PreviewConversationState = { state: 'disconnected', revealed: 1, typed: '', localMessages: [], showText: false };
export interface PreviewConcept {
  id: string;
  title: string;
  before: 0 | 1 | 2;
  after: 0 | 1 | 2;
  feedback: string;
  baseline: string;
  recheck: string;
  baselineAnswer: string;
  recheckAnswer: string;
}
export interface PreviewFixture {
  id: string;
  title: string;
  category: string;
  notes: string;
  nextStep: string;
  concepts: PreviewConcept[];
  transcript: { role: 'student' | 'learner'; text: string }[];
}

// Hand-authored public demonstration content. Never used by the practice API.
export const previewFixtures: PreviewFixture[] = [
  {
    id: 'heart', title: 'How the heart moves blood', category: 'Biology',
    notes: 'Pulmonary and systemic circulation, the four chambers, and one-way valves.',
    nextStep: 'Trace one red blood cell from the body to the lungs and back. Explain what changes at each stop.',
    concepts: [
      { id: 'circulation', title: 'Two circulation loops', before: 1, after: 2, baseline: 'Why does blood travel through both the lungs and the rest of the body?', recheck: 'Trace the journey of oxygen-poor blood from the body until it returns as oxygen-rich blood.', baselineAnswer: 'Blood goes to the lungs for oxygen, then gets pumped around the body.', recheckAnswer: 'It enters the right heart, travels to the lungs for gas exchange, returns to the left heart, and is pumped to the body.', feedback: 'The example follow-up connects both loops and the change in oxygen content.' },
      { id: 'chambers', title: 'Chambers & their roles', before: 2, after: 2, baseline: 'How do the roles of the atria and ventricles differ?', recheck: 'Why does blood enter an atrium before being pumped out by a ventricle?', baselineAnswer: 'Atria receive blood and ventricles pump it out of the heart.', recheckAnswer: 'The atrium receives returning blood and passes it to the ventricle, which pumps it into an artery.', feedback: 'Both example responses distinguish receiving blood from pumping it out.' },
      { id: 'valves', title: 'One-way blood flow', before: 0, after: 1, baseline: 'What keeps blood moving in one direction through the heart?', recheck: 'What could happen to blood flow if a heart valve did not close properly?', baselineAnswer: 'The heartbeat pushes blood forward.', recheckAnswer: 'Some blood could flow backward because the valve would not seal.', feedback: 'The example identifies backflow. Explaining pressure-driven opening and closing is the next step.' },
    ],
    transcript: [
      { role: 'student', text: 'I get that the heart is a pump. Why does blood need to go to the lungs first?' },
      { role: 'learner', text: 'The lungs let blood pick up oxygen and release carbon dioxide. Then the left side pumps it to the body.' },
      { role: 'student', text: 'That helps. What stops the blood from going backward when the heart relaxes?' },
      { role: 'learner', text: 'The valves close to stop backflow. I’m still figuring out how pressure makes that happen.' },
    ],
  },
  {
    id: 'recursion', title: 'Recursion & base cases', category: 'Computer science', notes: 'Base cases, smaller subproblems, and the call stack.',
    nextStep: 'Trace factorial(3) on paper. Show each call and what is returned as the stack unwinds.',
    concepts: [
      { id: 'base', title: 'Base cases', before: 1, after: 2, baseline: 'Why does a recursive function need a base case?', recheck: 'What would happen if factorial had no case that returns without a recursive call?', baselineAnswer: 'It needs a stopping point.', recheckAnswer: 'It would keep calling itself until it exhausted the stack instead of returning a result.', feedback: 'The example connects the stopping rule to termination and stack exhaustion.' },
      { id: 'smaller', title: 'Smaller subproblems', before: 2, after: 2, baseline: 'Why should each recursive call move closer to the base case?', recheck: 'Why does factorial(n) call factorial(n − 1) rather than factorial(n + 1) for positive n?', baselineAnswer: 'The input must get smaller so it reaches the stopping point.', recheckAnswer: 'Subtracting one reaches zero, the base case; adding one moves away from it.', feedback: 'Both examples explain progress toward the terminating case.' },
      { id: 'stack', title: 'Returning through the stack', before: 0, after: 1, baseline: 'What happens to waiting function calls when the base case returns?', recheck: 'After factorial(0) returns 1, how does factorial(2) obtain its result?', baselineAnswer: 'The function stops.', recheckAnswer: 'The waiting calls use the returned value to calculate their own results.', feedback: 'The example recognizes unwinding but still needs the specific 1 × 1 then 2 × 1 calculation.' },
    ],
    transcript: [{ role: 'student', text: 'How does a recursive function know when to stop?' }, { role: 'learner', text: 'A base case returns without making another recursive call.' }, { role: 'student', text: 'And how does each call get closer to that case?' }, { role: 'learner', text: 'The input gets smaller each time, like n minus one in factorial.' }],
  },
  {
    id: 'probability', title: 'Independent probability', category: 'Mathematics', notes: 'Independent events, multiplication, and complementary events.',
    nextStep: 'List the outcomes of two coin tosses, then explain why their probabilities multiply.',
    concepts: [
      { id: 'independence', title: 'Independent events', before: 1, after: 2, baseline: 'What does it mean for two events to be independent?', recheck: 'Why does a fair coin landing heads not change the chance of heads on the next toss?', baselineAnswer: 'The events are separate.', recheckAnswer: 'The first outcome does not change the probability of the second; it remains one half.', feedback: 'The follow-up example clearly connects independence to unchanged probability.' },
      { id: 'multiply', title: 'Combining probabilities', before: 2, after: 2, baseline: 'What is the probability of heads on two independent fair coin tosses?', recheck: 'What is the chance of rolling a six and then heads on an independent fair coin toss?', baselineAnswer: 'One half times one half is one quarter.', recheckAnswer: 'One sixth times one half is one twelfth.', feedback: 'Both examples correctly multiply independent probabilities.' },
      { id: 'complement', title: 'Complementary events', before: 0, after: 1, baseline: 'How can you find the chance of at least one head in two fair coin tosses?', recheck: 'How could you use the chance of no sixes to find the chance of at least one six in two rolls?', baselineAnswer: 'Add the chances of heads.', recheckAnswer: 'Subtract the chance of no sixes from one.', feedback: 'The example uses the complement correctly but does not calculate 1 − (5/6)² = 11/36.' },
    ],
    transcript: [{ role: 'student', text: 'Does getting heads make tails more likely next time?' }, { role: 'learner', text: 'No. Each toss is independent, so the chance is still one half.' }, { role: 'student', text: 'How would you combine the chances for two tosses?' }, { role: 'learner', text: 'Multiply them, because neither outcome changes the other.' }],
  },
];

export function fixtureQuestions(fixture: PreviewFixture, kind: PreviewKind): PracticeQuestion[] {
  return fixture.concepts.map((concept) => ({ id: `${fixture.id}-${kind}-${concept.id}`, conceptId: concept.id, prompt: concept[kind], supportsWorking: true }));
}
export function blankAnswers(fixture: PreviewFixture, kind: PreviewKind): AssessmentAnswer[] {
  return fixtureQuestions(fixture, kind).map((question) => ({ questionId: question.id, text: '', working: '', skipped: false, uncertain: false }));
}
