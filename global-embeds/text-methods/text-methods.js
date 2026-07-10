function truncateText(text, limit = 60) {
    if (typeof text !== 'string') return '';

    const cleanText = text.trim();
    if (cleanText.length <= limit) {
      return cleanText;
    }

    return (
      cleanText
        .slice(0, limit)
        .trim()
        .replace(/\s+\S*$/, '') + '...'
    );
  }