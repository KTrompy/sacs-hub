// A text input/textarea with a small "×" button that appears once it has a
// value, so a field can be emptied with one click instead of selecting or
// backspacing through it. `as="textarea"` renders a <textarea> instead.
export default function ClearableInput({ value, onClear, as = 'input', className, ...props }) {
  const Tag = as
  return (
    <div className={as === 'textarea' ? 'input-clear-wrap textarea' : 'input-clear-wrap'}>
      <Tag value={value} className={className} {...props} />
      {value && (
        <button type="button" className="search-clear" onClick={onClear} aria-label="Clear">×</button>
      )}
    </div>
  )
}
