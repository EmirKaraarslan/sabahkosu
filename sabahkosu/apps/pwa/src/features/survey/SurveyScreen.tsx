import { useState } from 'react';
import { ArrowLeft, Check, SkipForward } from 'lucide-react';
import type { SurveyResponse } from '../../types/models';

type SurveyKey = keyof SurveyResponse;
const questions: { key: SurveyKey; title: string; low: string; high: string }[] = [
  { key: 'paceFeel', title: 'Tempo hissi nasıldı?', low: 'Rahat', high: 'Zorlayıcı' },
  { key: 'durationFeel', title: 'Süre sana nasıl geldi?', low: 'Kısa', high: 'Uzun' },
  { key: 'fatigue', title: 'Ne kadar yoruldun?', low: 'Hiç yorulmadım', high: 'Çok yoruldum' }
];

export function SurveyScreen({ onSubmit, onSkip }: { onSubmit: (response: SurveyResponse) => void; onSkip: () => void }) {
  const [answers, setAnswers] = useState<Partial<SurveyResponse>>({});
  const complete = questions.every(({ key }) => typeof answers[key] === 'number');
  return (
    <main className="page survey-page">
      <button className="back-button" onClick={onSkip}><ArrowLeft size={18} /> Sonuca geç</button>
      <div className="survey-intro"><span className="step-label">KOŞU TAMAMLANDI</span><h1>Kendini nasıl hissettin?</h1><p>Üç kısa dokunuş. Bu puanlar rotandaki koşularını anlamana yardımcı olacak.</p></div>
      <div className="survey-questions">
        {questions.map(({ key, title, low, high }, index) => <section className="survey-question" key={key}>
          <div className="question-title"><span>{String(index + 1).padStart(2, '0')}</span><h2>{title}</h2></div>
          <div className="rating-row" role="radiogroup" aria-label={title}>{[1,2,3,4,5].map((value) => <button key={value} role="radio" aria-checked={answers[key] === value} className={answers[key] === value ? 'rating-selected' : ''} onClick={() => setAnswers((current) => ({ ...current, [key]: value }))}>{value}</button>)}</div>
          <div className="rating-labels"><span>{low}</span><span>{high}</span></div>
        </section>)}
      </div>
      <button className="primary-button survey-submit" disabled={!complete} onClick={() => onSubmit(answers as SurveyResponse)}><Check size={18} /> Değerlendirmeyi kaydet</button>
      <button className="text-button skip-survey" onClick={onSkip}><SkipForward size={16} /> Anketi atla</button>
    </main>
  );
}
