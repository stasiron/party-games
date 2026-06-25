import { useId, useState } from 'react';

function CmsAccordionSection({
    title,
    hint,
    meta,
    defaultOpen = false,
    selected = false,
    nested = false,
    children,
    className = '',
}) {
    const [open, setOpen] = useState(defaultOpen);
    const panelId = useId();

    return (
        <section
            className={[
                'cms-accordion',
                open ? 'cms-accordion--open' : '',
                nested ? 'cms-accordion--nested' : '',
                selected ? 'cms-accordion--selected' : '',
                className,
            ].filter(Boolean).join(' ')}
        >
            <button
                type="button"
                className="cms-accordion__trigger"
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => setOpen((value) => !value)}
            >
                <span className="cms-accordion__leading">
                    <span className="cms-accordion__chevron" aria-hidden="true" />
                    <span className="cms-accordion__titles">
                        <span className="cms-accordion__title">{title}</span>
                        {hint ? <span className="cms-accordion__hint">{hint}</span> : null}
                    </span>
                </span>
                {meta ? <span className="cms-accordion__meta">{meta}</span> : null}
            </button>
            <div
                id={panelId}
                className="cms-accordion__panel"
                hidden={!open}
            >
                <div className="cms-accordion__content">{children}</div>
            </div>
        </section>
    );
}

export default CmsAccordionSection;
