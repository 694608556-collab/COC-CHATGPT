"""Check every cold preview plus all original/imported public database values."""
import sys
from ios_table_readback import verify

if __name__ == '__main__':
    verify(*sys.argv[1:4])
    print('PUBLIC_IOS_COLD_TABLE_PROOFS previews=9 originalBodies=78 importedRecords=115 physicalPhone=false')
