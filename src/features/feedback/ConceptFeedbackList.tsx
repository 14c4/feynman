import type { ConceptCoverage, StudyTopic, TranscriptMessage } from '../../../shared/types';

const labels: Record<ConceptCoverage['status'], string> = {
  covered: 'Covered', partial: 'Needs detail', missing: 'Missing', misunderstood: 'Needs correction',
};

export function ConceptFeedbackList({ coverage, topic, transcript }: { coverage: ConceptCoverage[]; topic: StudyTopic; transcript: TranscriptMessage[] }) {
  return (
    <ul className="concept-list">
      {coverage.map((concept) => <li key={concept.conceptId} className={`concept-item concept-item--${concept.status}`}>
        <div className="concept-title"><h4>{topic.essentialConcepts.find((item) => item.id === concept.conceptId)?.title ?? concept.conceptId}</h4><span className="coverage-label">{labels[concept.status]}</span></div>
        <p>{concept.feedback}</p>
        {concept.evidenceMessageIds.map((id) => {
          const evidence = transcript.find((message) => message.id === id);
          return evidence ? <blockquote key={id}><span className="eyebrow">Sample transcript evidence</span><p>“{evidence.text}”</p></blockquote> : null;
        })}
      </li>)}
    </ul>
  );
}
