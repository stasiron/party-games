import ComingSoonGame from '../../components/ComingSoonGame';

/** Szablon — logika gry do zaimplementowania. */
function OneNightWerewolf({ isHost, onLeave }) {
    return <ComingSoonGame title="One Night Werewolf" isHost={isHost} onLeave={onLeave} />;
}

export default OneNightWerewolf;
