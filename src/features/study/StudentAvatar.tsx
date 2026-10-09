export function StudentAvatar({ small = false }: { small?: boolean }) {
  return (
    <div className={`student-avatar ${small ? 'student-avatar--small' : ''}`} role="img" aria-label="Illustration of a friendly virtual student">
      <svg viewBox="0 0 160 160" aria-hidden="true">
        <circle cx="80" cy="80" r="79" fill="currentColor" />
        <path d="M37 160v-15c0-22 19-36 43-36s43 14 43 36v15" fill="#648879" />
        <path d="M65 100v22c8 8 22 8 30 0v-22" fill="#e1bb96" />
        <ellipse cx="80" cy="75" rx="35" ry="41" fill="#edc9a6" />
        <path d="M45 73c-9-32 6-51 33-51 30 0 42 20 36 52l-9-19c-22 5-36-2-43-10-4 12-10 21-17 28" fill="#354d42" />
        <circle cx="67" cy="76" r="3" fill="#35433b" /><circle cx="94" cy="76" r="3" fill="#35433b" />
        <path d="M72 91q8 8 16 0" fill="none" stroke="#805b46" strokeWidth="3" strokeLinecap="round" />
        <path d="M50 139q30 13 60 0" fill="none" stroke="#507565" strokeWidth="2" />
      </svg>
    </div>
  );
}
