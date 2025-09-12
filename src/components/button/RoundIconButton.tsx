export default function RoundIconButton(props: {
  children: React.ReactNode;
  label?: string;
  onClick?: () => void;
}) {
  const { children, label, onClick } = props;

  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      style={{
        width: 40,
        height: 40,
        borderRadius: 9999,
        display: "grid",
        placeItems: "center",
        border: "1px solid rgba(0,0,0,.15)",
        background: "white",
        boxShadow: "0 2px 6px rgba(0,0,0,.06)",
        cursor: "pointer",
        transition: "transform .06s ease",
      }}
      onMouseDown={(e) => (e.currentTarget.style.transform = "scale(0.96)")}
      onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
      onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
    >
      {children}
    </button>
  );
}
