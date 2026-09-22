# Base-R data-only inspection of selected saved captures. Never source archived code.
root <- 'data/legacy/coverage'
dir.create(file.path(root, 'decoded'), showWarnings=FALSE)
manifest <- read.csv(file.path(root, 'sample-inputs.csv'), stringsAsFactors=FALSE)
total <- readRDS('data/legacy/originals/f41b3299e0c54008da9ed81b8f13e77bea7d5fc3.rds')
fields <- c('V1','V2','V3','V4','V5','V6','outage_num','cust_affected')
stopifnot(identical(names(total), c(fields, 'time')))
groups <- split(seq_len(nrow(total)), total$time)
inspection <- list(); event_rows <- list()
for (i in seq_len(nrow(manifest))) {
  f <- manifest[i, ]
  stopifnot(file.info(f$local)$size < 2 * 1024^2)
  text <- grepl('(\\.txt|_txt\\.rds)$', f$path)
  if (text) {
    x <- if (grepl('_txt\\.rds$', f$path)) readRDS(f$local) else readLines(f$local, warn=FALSE, encoding='UTF-8')
    stopifnot(is.character(x), !anyNA(x), length(x) < 100000)
    output <- file.path(root, 'decoded', paste0(f$blob, '.txt'))
    writeLines(x, output, useBytes=TRUE)
    inspection[[i]] <- data.frame(repository=f$repository, path=f$path, blob=f$blob,
      kind='saved-head-text', rows=NA_integer_, storedTime='', matchedSourceTime='', fullContentMatch=FALSE, comparison='not-applicable', decoded=output)
    next
  }
  if (grepl('\\.RData$', f$path)) {
    env <- new.env(parent=emptyenv())
    objects <- load(f$local, envir=env)
    stopifnot(identical(objects, 'events_detail'))
    x <- get('events_detail', envir=env)
  } else {
    stopifnot(grepl('\\.csv$', f$path))
    x <- read.csv(f$local, colClasses='character', na.strings=NULL, check.names=FALSE, stringsAsFactors=FALSE)
  }
  stopifnot(inherits(x, 'data.frame'), nrow(x) < 10000)
  value <- ''; found <- character(); kind <- 'empty-event-table'; comparison <- 'not-applicable'
  if (nrow(x)) {
    stopifnot(all(c(fields, 'time') %in% names(x)))
    time <- unique(x$time)
    stopifnot(length(time) == 1L)
    numeric <- inherits(time, 'POSIXct')
    candidates <- if (numeric) c(format(time, tz='America/Chicago', format='%Y-%m-%d %H:%M:%S'), format(time, tz='UTC', format='%Y-%m-%d %H:%M:%S')) else as.character(time)
    value <- if (numeric) sprintf('%.17g', as.numeric(time)) else as.character(time)
    kind <- if (numeric) 'epoch-event-table' else 'character-event-table'
    compare <- x[fields]
    comparison <- 'exact-fields'
    if (grepl('\\.csv$', f$path)) {
      # The consolidated CSV import trims outer whitespace and uses NA for empty
      # fields. Record that normalization explicitly; retain unmodified rows below.
      compare <- lapply(compare, function(v) { v <- trimws(v); v[v == '' | v == 'NA'] <- NA_character_; v })
      comparison <- 'csv-trim-and-missing-normalization'
    }
    for (candidate in unique(candidates)) {
      index <- groups[[candidate]]
      if (!is.null(index) && identical(lapply(compare, as.character), lapply(total[index, fields], as.character))) found <- c(found, candidate)
    }
    stopifnot(length(found) <= 1L)
    rows <- data.frame(repository=f$repository, path=f$path, blob=f$blob, row=seq_len(nrow(x)), stringsAsFactors=FALSE)
    for (field in fields) rows[[field]] <- as.character(x[[field]])
    event_rows[[length(event_rows)+1L]] <- rows
  }
  inspection[[i]] <- data.frame(repository=f$repository, path=f$path, blob=f$blob,
    kind=kind, rows=nrow(x), storedTime=value, matchedSourceTime=if (length(found)) found else '', fullContentMatch=length(found)==1L, comparison=comparison, decoded='')
}
write.csv(do.call(rbind, inspection), file.path(root, 'inspection.csv'), row.names=FALSE, na='')
connection <- gzfile(file.path(root, 'sample-events.csv.gz'), 'wt', encoding='UTF-8')
write.csv(do.call(rbind, event_rows), connection, row.names=FALSE, na='')
close(connection)
print(table(do.call(rbind, inspection)$kind))
print(table(do.call(rbind, inspection)$fullContentMatch))
