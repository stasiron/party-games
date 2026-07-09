import { useCallback } from 'react';
import { getNeverHaveIEverCategories } from '../../lib/gameContentUtils';
import DeckQuestionGame from '../_shared/DeckQuestionGame';

function NeverHaveIEver(props) {
    const getCategories = useCallback(
        (section) => getNeverHaveIEverCategories(section),
        []
    );

    return (
        <DeckQuestionGame
            {...props}
            gameId="never-have-i-ever"
            contentKey="neverHaveIEver"
            getCategories={getCategories}
        />
    );
}

export default NeverHaveIEver;
