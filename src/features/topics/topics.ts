import type { StudyTopic } from '../../../shared/types';

export const topics: StudyTopic[] = [
  {
    id: 'recursion',
    title: 'Recursion',
    category: 'Computer science',
    description: 'Big problems, smaller versions. Explain how a function can call itself.',
    openingPrompt: 'How would you explain recursion to someone who has never written code?',
    essentialConcepts: [
      { id: 'self-call', title: 'Self-calls', description: 'A function calls itself to solve a smaller instance of a problem.' },
      { id: 'base-case', title: 'The base case', description: 'A stopping condition returns without another recursive call.' },
      { id: 'progress', title: 'Progress toward stopping', description: 'Each call moves toward the base case.' },
      { id: 'return-values', title: 'Returning through the calls', description: 'Results return through pending calls to solve the original problem.' },
    ],
  },
  {
    id: 'derivatives',
    title: 'Derivatives',
    category: 'Mathematics',
    description: 'Make sense of change. Explain what a derivative tells us in everyday terms.',
    openingPrompt: 'What is a derivative, and how could you explain it using a moving car?',
    essentialConcepts: [
      { id: 'rate', title: 'Instantaneous rate of change', description: 'A derivative describes how fast a quantity changes at a point.' },
      { id: 'slope', title: 'Tangent slope', description: 'A derivative is the slope of a tangent to the graph at a point.' },
      { id: 'limit', title: 'The limit idea', description: 'Average rates approach an instantaneous rate over shrinking intervals.' },
    ],
  },
  {
    id: 'photosynthesis',
    title: 'Photosynthesis',
    category: 'Biology',
    description: 'From sunlight to stored energy. Teach how plants make their own food.',
    openingPrompt: 'How does a plant use sunlight to make food, and what does it need?',
    essentialConcepts: [
      { id: 'light', title: 'Capturing light', description: 'Chlorophyll captures light energy in chloroplasts.' },
      { id: 'inputs', title: 'Water and carbon dioxide', description: 'Water and carbon dioxide provide the inputs for making sugars.' },
      { id: 'outputs', title: 'Sugar and oxygen', description: 'Energy is stored in sugars and oxygen is released.' },
    ],
  },
];

export function getTopic(id: string) {
  return topics.find((topic) => topic.id === id);
}
