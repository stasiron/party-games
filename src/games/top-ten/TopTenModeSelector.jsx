import { useLocale } from '../../locales/LocaleContext';
import {
    TOP_TEN_ORDERING_MODE_LIST,
    normalizeOrderingMode,
} from './orderingModes';

function TopTenModeSelector({ value, onChange, onBackToRoom }) {
    const { t } = useLocale();
    const selected = normalizeOrderingMode(value);
    const groupLabel = t('gameSetup.topTen.orderingModeTitle');

    return (
        <div className="option-picker" role="radiogroup" aria-label={groupLabel}>
            <p className="option-picker__legend">{groupLabel}</p>
            <ul className="option-picker__list">
                {TOP_TEN_ORDERING_MODE_LIST.map((modeId) => {
                    const isActive = selected === modeId;
                    return (
                        <li key={modeId}>
                            <button
                                type="button"
                                role="radio"
                                aria-checked={isActive}
                                className={`option-picker__btn ${isActive ? 'option-picker__btn--active' : ''}`}
                                onClick={() => onChange(modeId)}
                            >
                                <strong className="option-picker__title">
                                    {t(`gameSetup.topTen.orderingModes.${modeId}.title`)}
                                </strong>
                                <span className="option-picker__hint">
                                    {t(`gameSetup.topTen.orderingModes.${modeId}.hint`)}
                                </span>
                            </button>
                        </li>
                    );
                })}
            </ul>
            {onBackToRoom && (
                <button type="button" className="btn-link option-picker__back" onClick={onBackToRoom}>
                    {t('gameSetup.topTen.backToRoom')}
                </button>
            )}
        </div>
    );
}

export default TopTenModeSelector;
