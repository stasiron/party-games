import { useCallback } from 'react';
import { useLocale } from '../../locales/LocaleContext';
import { getKtoNajpredzejCategories } from '../../lib/gameContentUtils';
import DeckQuestionGame from '../_shared/DeckQuestionGame';

function KtoNajpredzej(props) {
    const { t } = useLocale();
    const getCategories = useCallback(
        (section) => getKtoNajpredzejCategories(section),
        []
    );

    return (
        <DeckQuestionGame
            {...props}
            gameId="kto-najpredzej"
            contentKey="ktoNajpredzej"
            getCategories={getCategories}
            hostLeaveLabelKey="gameUi.closeRoom"
            renderInGameHint={<p className="knp-hint">{t('gameUi.ktoNajpredzejHint')}</p>}
        />
    );
}

export default KtoNajpredzej;
