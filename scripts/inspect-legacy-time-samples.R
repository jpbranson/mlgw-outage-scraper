# Read selected RData objects into isolated environments; never source their code.
manifest <- read.csv('data/legacy/time-evidence/capture-inputs.csv', stringsAsFactors=FALSE)
result <- list()
for (i in seq_len(nrow(manifest))) {
  row <- manifest[i, ]
  if (!grepl('\\.RData$', row$path)) next
  isolated <- new.env(parent=emptyenv())
  names <- load(row$local, envir=isolated)
  stopifnot(identical(names, 'events_detail'))
  x <- get('events_detail', envir=isolated)
  stopifnot(inherits(x, 'data.frame'), nrow(x) > 0)
  time <- unique(x$time)
  stopifnot(length(time) == 1L)
  numeric_time <- inherits(time, 'POSIXct')
  raw <- if (numeric_time) format(time, tz='UTC', format='%Y-%m-%dT%H:%M:%OS6Z') else as.character(time)
  result[[length(result)+1L]] <- data.frame(repository=row$repo, commit=row$commit, committed_at=row$time,
    filename=row$path, blob=row$blob, stored_class=paste(class(time),collapse='/'), stored_type=typeof(time),
    stored_tzone=if (is.null(attr(time,'tzone'))) '<NULL>' else paste(attr(time,'tzone'),collapse='/'),
    source_time=raw, epoch_seconds=if (numeric_time) sprintf('%.6f',as.numeric(time)) else '',
    outages=unique(x$outage_num), customers=unique(x$cust_affected), source_rows=nrow(x))
}
out <- do.call(rbind,result)
write.csv(out,'data/legacy/time-evidence/capture-time-inspection.csv',row.names=FALSE)
print(out[c('repository','committed_at','filename','stored_class','stored_tzone','source_time','epoch_seconds')], row.names=FALSE)
