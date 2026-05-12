import { Link } from 'react-router-dom';

export interface BreadcrumbItem {
  label: string;
  href?: string; // omit for the current (last) page
}

const truncate = (s: string, max = 24) => s.length > max ? s.slice(0, max) + '…' : s;

export default function Breadcrumb({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex items-center flex-wrap gap-0.5 mb-3">
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        return (
          <span key={i} className="flex items-center gap-0.5">
            {i > 0 && (
              <span className="text-[13px] text-on-surface-variant/40 select-none mx-1">›</span>
            )}
            {isLast ? (
              <span className="text-[13px] font-semibold text-primary" aria-current="page">
                {truncate(item.label)}
              </span>
            ) : (
              <Link
                to={item.href!}
                className="text-[13px] text-on-surface-variant hover:text-primary transition-colors"
              >
                {truncate(item.label)}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
