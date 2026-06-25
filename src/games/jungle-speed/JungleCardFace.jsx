import { useMemo } from 'react';
import { useLocale } from '../../locales/LocaleContext';
import { getCardFillColor, getCustomCardUrl, getShapeSvgRaw } from './cardAssets';

/**
 * Wizualna karta: opcjonalny pełny SVG (`assets/jungle-speed/cards/{id}.svg`)
 * albo kształt (`shapes/{shape}.svg`) + kolor z JSON.
 *
 * @param {{ card?: { id: string, shape: string, color: string } | null, size?: 'lg' | 'sm', className?: string }} props
 */
function JungleCardFace({ card, size = 'lg', className = '' }) {
    const { t } = useLocale();

    const label = useMemo(() => {
        if (!card) return '';
        const shape = t(`gameUi.jungleShape.${card.shape}`, {}, card.shape);
        const color = t(`gameUi.jungleColor.${card.color}`, {}, card.color);
        return `${shape}, ${color}`;
    }, [card, t]);

    if (!card) {
        return (
            <div className={`jungle-card-face jungle-card-face--empty jungle-card-face--${size} ${className}`.trim()}>
                <span className="jungle-card-face__placeholder">?</span>
            </div>
        );
    }

    const customUrl = getCustomCardUrl(card.id);
    const shapeRaw = getShapeSvgRaw(card.shape);
    const fill = getCardFillColor(card.color);

    if (customUrl) {
        return (
            <div className={`jungle-card-face jungle-card-face--custom jungle-card-face--${size} ${className}`.trim()}>
                <img src={customUrl} alt="" className="jungle-card-face__custom-img" draggable={false} />
                <span className="sr-only">{label}</span>
            </div>
        );
    }

    if (shapeRaw) {
        return (
            <div
                className={`jungle-card-face jungle-card-face--shape jungle-card-face--${size} ${className}`.trim()}
                style={{ color: fill }}
                dangerouslySetInnerHTML={{ __html: shapeRaw }}
                role="img"
                aria-label={label}
            />
        );
    }

    return (
        <div className={`jungle-card-face jungle-card-face--fallback jungle-card-face--${size} ${className}`.trim()}>
            <span className="jungle-card-face__fallback-text" aria-label={label}>
                {t(`gameUi.jungleShape.${card.shape}`, {}, card.shape)}
            </span>
            <span className="sr-only">{label}</span>
        </div>
    );
}

export default JungleCardFace;
