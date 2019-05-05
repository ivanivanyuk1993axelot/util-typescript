import {LoadingCache} from './loading-cache';
import {forkJoin, Observable, of, throwError, TimeoutError, timer} from 'rxjs';
import {catchError, first, map, mergeMap, tap} from 'rxjs/operators';
import {ILoadResult} from './i-load-result';
import {ILoadingCacheLoader} from './i-loading-cache-loader';
import {TestBed} from '@angular/core/testing';

const allowedApproximateTimeDifference = 5;
const loadTime = 50;
const refreshTime = 100;
const spoilTime = 1000;
const timeout = 200;

function isCurrentTimestampApproximatelyEqualTo(
  timestamp: number,
): boolean {
  const currentTimestamp = Date.now();
  return timestamp - allowedApproximateTimeDifference <= currentTimestamp
    && currentTimestamp <= timestamp + allowedApproximateTimeDifference;
}

interface TestKey {
  key: string;
  loadErrorTime?: number;
  loadTime?: number;
  shouldLoadThrowError?: boolean;
  shouldStoreThrowError?: boolean;
  storeTime?: number;
}

interface TestRecord {
  key: string;
  loadCount: number;
  storeCount: number;
}

class TestCacheLoader implements ILoadingCacheLoader<TestKey, TestRecord> {
  private _keyToLoadCountMap = new Map<string, number>();

  load$(
    key: TestKey,
  ): Observable<ILoadResult<TestRecord>> {
    if (key.shouldLoadThrowError) {
      return timer(key.loadErrorTime || 0).pipe(
        mergeMap(() => {
          return throwError(new Error(key.key));
        }),
      );
    } else {
      return timer(key.loadTime || loadTime).pipe(
        map(() => {
          if (!this._keyToLoadCountMap.has(key.key)) {
            this._keyToLoadCountMap.set(key.key, 0);
          }
          this._keyToLoadCountMap.set(
            key.key,
            this._keyToLoadCountMap.get(key.key) + 1,
          );

          return {
            timestamp: Date.now(),
            value: {
              key: key.key,
              loadCount: this._keyToLoadCountMap.get(key.key),
            },
          };
        }),
        first(),
      );
    }
  }

  store$(key: TestKey, value: TestRecord): Observable<ILoadResult<TestRecord>> {
    if (key.shouldStoreThrowError) {
      return throwError(new Error(key.key));
    } else {
      return timer(key.storeTime || loadTime).pipe(
        map(() => {
          if (!this._keyToLoadCountMap.has(key.key)) {
            this._keyToLoadCountMap.set(key.key, 0);
          }
          this._keyToLoadCountMap.set(
            key.key,
            this._keyToLoadCountMap.get(key.key) + 1,
          );

          return {
            timestamp: Date.now(),
            value: value,
          };
        }),
        first(),
      );
    }
  }
}

describe('LoadingCache', () => {
  let loadingCache: LoadingCache<TestKey, TestRecord>;

  beforeEach(() => {
    loadingCache = new LoadingCache({
      cacheLoader: new TestCacheLoader,
      refreshTime,
      spoilTime,
      timeout,
    });
  });

  it('getShouldHaveOnlyOneSimultaneousLoad', (done: DoneFn) => {
    const key: TestKey = {
      key: Math.random().toString(),
    };

    forkJoin(
      Array.from(new Array(10)).map(() => {
        return loadingCache.get$(key).pipe(
          tap(record => {
            expect(record.key).toBe(key.key);
            expect(record.loadCount).toBe(1);
          }),
        );
      }),
    ).subscribe(done);
  });

  it('getCallsShouldReturnNotSpoiledRecordsImmediately', (done: DoneFn) => {
    const key: TestKey = {
      key: Math.random().toString(),
    };

    loadingCache.get$(key).subscribe(() => {
      const expectedLoadFinishTimestamp = Date.now();

      forkJoin(
        Array.from(new Array(10)).map(() => {
          return loadingCache.get$(key).pipe(
            tap(recordLocal => {
              expect(recordLocal.key).toBe(key.key);
              expect(recordLocal.loadCount).toBe(1);
              expect(isCurrentTimestampApproximatelyEqualTo(expectedLoadFinishTimestamp)).toBeTruthy();
            }),
          );
        }),
      ).subscribe(() => {
        done();
      });
    });
  });

  it('getCallsDuringLoadShouldCompleteImmediatelyAfterLoad', (done: DoneFn) => {
    const key: TestKey = {
      key: Math.random().toString(),
    };

    const expectedLoadFinishTimestamp = Date.now() + loadTime;

    forkJoin(
      Array.from(new Array(10)).map(() => {
        return loadingCache.get$(key).pipe(
          tap(record => {
            expect(record.key).toBe(key.key);
            expect(record.loadCount).toBe(1);
            expect(isCurrentTimestampApproximatelyEqualTo(expectedLoadFinishTimestamp)).toBeTruthy();
          }),
        );
      }),
    ).subscribe(() => {
      done();
    });
  });

  it('getShouldHandleError', (done: DoneFn) => {
    const key: TestKey = {
      key: Math.random().toString(),
      shouldLoadThrowError: true,
    };

    forkJoin(
      Array.from(new Array(10)).map(() => {
        return loadingCache.get$(key).pipe(
          catchError(error => {
            return of(error);
          }),
        );
      }),
    ).subscribe((errorList) => {
      expect(Array.isArray(errorList)).toBe(true);
      for (const error of errorList) {
        expect(error instanceof Error).toBe(true);
        expect(error.message).toBe(key.key);
      }
      done();
    });
  });

  it('getCallsDuringLoadWithErrorShouldCompleteImmediatelyAfterLoad', (done: DoneFn) => {
    const key: TestKey = {
      key: Math.random().toString(),
      shouldLoadThrowError: true,
    };

    const expectedLoadFinishTimestamp = Date.now();

    forkJoin(
      Array.from(new Array(10)).map(() => {
        return loadingCache.get$(key).pipe(
          catchError(err => {
            expect(isCurrentTimestampApproximatelyEqualTo(expectedLoadFinishTimestamp)).toBeTruthy();
            return of(err);
          }),
        );
      }),
    ).subscribe((errorList) => {
      expect(Array.isArray(errorList)).toBe(true);
      for (const error of errorList) {
        expect(error instanceof Error).toBe(true);
        expect(error.message).toBe(key.key);
      }
      done();
    });
  });

  it('getShouldThrowTimeoutError', (done: DoneFn) => {
    const key: TestKey = {
      key: Math.random().toString(),
      loadTime: timeout,
    };

    forkJoin(
      Array.from(new Array(10)).map(() => {
        return loadingCache.get$(key).pipe(
          catchError(error => {
            return of(error);
          }),
        );
      }),
    ).subscribe((errorList) => {
      expect(Array.isArray(errorList)).toBe(true);
      for (const error of errorList) {
        expect(error instanceof TimeoutError).toBe(true);
      }
      done();
    });
  });

  it('getCallsShouldThrowTimeoutErrorImmediatelyAfterTimeout', (done: DoneFn) => {
    const key: TestKey = {
      key: Math.random().toString(),
      loadTime: timeout,
    };

    const expectedLoadFinishTimestamp = Date.now() + timeout;

    forkJoin(
      Array.from(new Array(10)).map(() => {
        return loadingCache.get$(key).pipe(
          catchError(err => {
            expect(isCurrentTimestampApproximatelyEqualTo(expectedLoadFinishTimestamp)).toBeTruthy();
            return of(err);
          }),
        );
      }),
    ).subscribe((errorList) => {
      expect(Array.isArray(errorList)).toBe(true);
      for (const error of errorList) {
        expect(error instanceof TimeoutError).toBe(true);
      }
      done();
    });
  });

  it('getShouldNotHandleLoadResultWhenRecordIsUpdatedFromStore', (done: DoneFn) => {
    const storeTime = 1; // not 0 because key.storeTime || loadTime === loadTime
    const key: TestKey = {
      key: Math.random().toString(),
      storeTime,
    };

    const storeRecord = {
      key: `storeResult:${key.key}`,
      loadCount: 100,
    };

    const expectedLoadFinishTimestamp = Date.now() + storeTime;

    forkJoin(
      ...Array.from(new Array(10)).map(() => {
        return loadingCache.get$(key).pipe(
          tap(() => {
            expect(isCurrentTimestampApproximatelyEqualTo(expectedLoadFinishTimestamp)).toBeTruthy();
          }),
        );
      }),
      loadingCache.set$(key, storeRecord),
    ).subscribe((resultList) => {
      for (const result of resultList) {
        expect(result.key).toBe(`storeResult:${key.key}`);
        expect(result.loadCount).toBe(100);
      }
      done();
    });
  });

  it('getShouldNotHandleLoadErrorWhenRecordIsUpdatedFromStore', (done: DoneFn) => {
    const storeTime = 1; // not 0 because key.storeTime || loadTime === loadTime
    const key: TestKey = {
      key: Math.random().toString(),
      loadErrorTime: loadTime,
      shouldLoadThrowError: true,
      storeTime,
    };

    const storeRecord = {
      key: `storeResult:${key.key}`,
      loadCount: 100,
    };

    const expectedLoadFinishTimestamp = Date.now() + storeTime;

    forkJoin(
      ...Array.from(new Array(10)).map(() => {
        return loadingCache.get$(key).pipe(
          tap(() => {
            expect(isCurrentTimestampApproximatelyEqualTo(expectedLoadFinishTimestamp)).toBeTruthy();
          }),
        );
      }),
      loadingCache.set$(key, storeRecord),
    ).subscribe((resultList) => {
      for (const result of resultList) {
        expect(result.key).toBe(`storeResult:${key.key}`);
        expect(result.loadCount).toBe(100);
      }
      done();
    });
  });
});
