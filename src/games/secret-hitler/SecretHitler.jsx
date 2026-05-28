import ComingSoonGame from '../../components/ComingSoonGame';

/** Szablon — logika gry do zaimplementowania. */
function SecretHitler({ isHost, onLeave }) {
    return <ComingSoonGame title="Secret Hitler" isHost={isHost} onLeave={onLeave} />;
}

export default SecretHitler;
