# Independent comparison: reread retained R objects and compare every staged source projection.
# No use of the export/audit implementations or of legacy scraper code.
sources <- read.csv('data/legacy/verification/sources.csv', stringsAsFactors=FALSE)
results <- list()
for (i in seq_len(nrow(sources))) {
  s <- sources[i, ]
  original <- readRDS(s$original)
  class(original) <- 'data.frame'
  connection <- gzfile(s$projection, 'rt')
  projected <- read.csv(connection, colClasses='character', check.names=FALSE, stringsAsFactors=FALSE)
  close(connection)
  projected$source_row <- as.integer(projected$source_row)
  projected <- projected[order(projected$source_row), ]
  stopifnot(!anyDuplicated(projected$source_row))
  if (s$kind == 'totals') {
    unique_indices <- which(!duplicated(original$time))
    stopifnot(identical(projected$source_row, unique_indices))
    raw <- original[unique_indices, ]
    stopifnot(identical(projected$time, raw$time))
    stopifnot(identical(as.integer(projected$outages), as.integer(gsub('[^0-9]', '', raw$outage_num))))
    stopifnot(identical(as.integer(projected$customers), as.integer(gsub('[^0-9]', '', raw$cust_affected))))
    freq <- table(original$time)
    stopifnot(identical(as.integer(projected$source_rows), as.integer(freq[projected$time])))
    # All repeated event rows must agree with the projected capture summary.
    map <- match(original$time, projected$time)
    stopifnot(all(as.integer(gsub('[^0-9]', '', original$outage_num)) == as.integer(projected$outages[map])))
    stopifnot(all(as.integer(gsub('[^0-9]', '', original$cust_affected)) == as.integer(projected$customers[map])))
  } else {
    valid <- which(is.finite(original$long) & is.finite(original$lat))
    stopifnot(identical(projected$source_row, valid))
    raw <- original[valid, ]
    stopifnot(identical(projected$filename, raw$filename), identical(projected$id, raw$id))
    stopifnot(identical(as.numeric(projected$long), raw$long), identical(as.numeric(projected$lat), raw$lat))
    stopifnot(identical(as.integer(projected$customers), as.integer(raw$custs_num)))
  }
  cat('VERIFIED', s$blob, s$kind, nrow(projected), 'projected records;', nrow(original), 'original rows\n')
  results[[i]] <- data.frame(blob=s$blob, kind=s$kind, projected_rows=nrow(projected),
                             original_rows=nrow(original), verified=TRUE)
}
write.csv(do.call(rbind, results), 'data/legacy/verification/results.csv', row.names=FALSE)
