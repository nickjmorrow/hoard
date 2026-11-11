// 1-to-5 stars. Tapping the current rating again clears it.

export function Stars({ rating, onRate }: { rating: number | undefined; onRate: (r: number | null) => void }) {
  return (
    <div className="stars" role="group" aria-label={rating ? `Rating: ${rating} of 5` : 'Rating: none'}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className={rating !== undefined && n <= rating ? 'on' : ''}
          aria-label={`${n} star${n === 1 ? '' : 's'}`}
          aria-pressed={rating === n}
          onClick={() => onRate(rating === n ? null : n)}
        >
          <span aria-hidden="true">★</span>
        </button>
      ))}
    </div>
  )
}
