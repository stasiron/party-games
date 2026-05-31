import { useLocale } from '../locales/LocaleContext';

function GameRulesList({ gameId }) {
    const { getGameRules } = useLocale();
    const rules = getGameRules(gameId);

    if (!rules.length) return null;

    return (
        <ol className="game-rules__list">
            {rules.map((line, index) => (
                <li key={index}>{line}</li>
            ))}
        </ol>
    );
}

export default GameRulesList;
