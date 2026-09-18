// A cascading chevron pattern echoing the "tech" glow look of share cards on
// trading platforms — an original geometric pattern, not a copied logo/asset.
export function ChevronGlow({ tone }: { tone: string }) {
  return (
    <svg className="pointer-events-none absolute -right-4 -top-4 h-52 w-52 opacity-[0.14]" viewBox="0 0 200 200" fill="none">
      {[0, 34, 68, 102].map((offset) => (
        <path
          key={offset}
          d={`M ${120 - offset} 8 L ${182 - offset} 70 L ${120 - offset} 132`}
          stroke={tone}
          strokeWidth="9"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  )
}
