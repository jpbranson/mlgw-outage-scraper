# Recover absolute epochs and verify complete event-table contents against the consolidated original.
# Only isolated, data-only RData loading; never execute a legacy scraper.
root <- 'data/legacy/recovery-evidence'
manifest <- read.csv(file.path(root, 'capture-inputs.csv'), stringsAsFactors=FALSE)
original_path <- 'data/legacy/originals/f41b3299e0c54008da9ed81b8f13e77bea7d5fc3.rds'
total <- readRDS(original_path)
fields <- c('V1','V2','V3','V4','V5','V6','outage_num','cust_affected')
stopifnot(identical(names(total), c(fields, 'time')))
groups <- split(seq_len(nrow(total)), total$time)
matches <- list(); inspected <- list()
same_content <- function(a, b) identical(lapply(a[fields], as.character), lapply(b[fields], as.character))
for (i in seq_len(nrow(manifest))) {
  file <- manifest[i, ]
  env <- new.env(parent=emptyenv())
  objects <- load(file$local, envir=env)
  stopifnot(identical(objects, 'events_detail'))
  x <- get('events_detail', envir=env)
  stopifnot(inherits(x, 'data.frame'), nrow(x) < 10000)
  if (!nrow(x)) {
    inspected[[i]] <- data.frame(blob=file$blob, rows=0L, kind='empty', match_count=0L)
    next
  }
  stopifnot(all(c(fields, 'time') %in% names(x)))
  time <- unique(x$time)
  stopifnot(length(time) == 1L)
  numeric <- inherits(time, 'POSIXct')
  if (numeric) {
    candidates <- c(central=format(time, tz='America/Chicago', format='%Y-%m-%d %H:%M:%S'),
                    utc=format(time, tz='UTC', format='%Y-%m-%d %H:%M:%S'))
  } else {
    stopifnot(is.character(time))
    candidates <- c(character=time)
  }
  found <- 0L
  for (j in seq_along(candidates)) {
    value <- unname(candidates[j])
    indices <- groups[[value]]
    if (is.null(indices) || !same_content(x, total[indices, ])) next
    found <- found + 1L
    matches[[length(matches)+1L]] <- data.frame(repository=file$repository, commit=file$commit,
      filename=file$path, blob=file$blob, matched_source_time=value, rendering=names(candidates)[j],
      epoch_seconds=if (numeric) sprintf('%.17g', as.numeric(time)) else '',
      first_source_row=min(indices), source_rows=length(indices),
      outages=unique(x$outage_num), customers=unique(x$cust_affected), full_event_content_match=TRUE)
  }
  inspected[[i]] <- data.frame(blob=file$blob, rows=nrow(x), kind=if (numeric) 'epoch' else 'character', match_count=found)
}
write.csv(do.call(rbind, matches), file.path(root, 'original-matches.csv'), row.names=FALSE)
write.csv(do.call(rbind, inspected), file.path(root, 'inspection.csv'), row.names=FALSE)
cat('Inspected originals:', nrow(manifest), 'full-content matches:', length(matches), '\n')
print(table(do.call(rbind, inspected)$kind))
print(table(do.call(rbind, matches)$rendering))
