"""Apply the production acceptance gate to a complete public simulator result."""
import json
import sys
from ios_search_acceptance import verify

if __name__ == '__main__':
    rows = verify(json.load(open(sys.argv[1], encoding='utf-8')))
    print(json.dumps({'passed': True, 'completeSearches': len(rows), 'physicalPhone': False}))
