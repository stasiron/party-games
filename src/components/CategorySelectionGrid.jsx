function CategorySelectionGrid({ categories, selectedIds, onToggle }) {
    return (
        <div className="games-grid categories-grid">
            {categories.map((cat) => {
                const isSelected = selectedIds.includes(cat.id);
                return (
                    <button
                        key={cat.id}
                        type="button"
                        onClick={() => onToggle(cat.id)}
                        className={isSelected ? 'category-btn-selected' : 'category-btn-unselected'}
                    >
                        <span className="game-title">{cat.name}</span>
                        <span className="game-desc">{cat.desc}</span>
                    </button>
                );
            })}
        </div>
    );
}

export default CategorySelectionGrid;
