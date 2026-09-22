# Independent conversion using base R's timezone database, plus rereading original numeric timestamps.
directory <- readLines('data/legacy/recovered/verification-path.txt', warn=FALSE)
stopifnot(length(directory)==1L, startsWith(directory, 'data/legacy/recovered/legacy-time-recovery-v1/'))
read_projection <- function(name) {
  file <- gzfile(file.path(directory,paste0(name,'.csv.gz')),'rt'); on.exit(close(file))
  read.csv(file,colClasses='character',check.names=FALSE,stringsAsFactors=FALSE)
}
utc <- function(value) as.numeric(as.POSIXct(value,tz='UTC',format='%Y-%m-%dT%H:%M:%OSZ'))
clock <- function(value,zone) as.numeric(as.POSIXct(value,tz=zone,format='%Y-%m-%d %H:%M:%OS'))
totals <- read_projection('totals')
source <- readRDS('data/legacy/originals/f41b3299e0c54008da9ed81b8f13e77bea7d5fc3.rds')
index <- as.integer(totals$first_source_row)
stopifnot(identical(totals$source_time,source$time[index]))
stopifnot(all(as.integer(totals$outages)==as.integer(gsub('[^0-9]','',source$outage_num[index]))))
stopifnot(all(as.integer(totals$customers)==as.integer(gsub('[^0-9]','',source$cust_affected[index]))))
known <- totals$observed_at!=''
stopifnot(sum(!known)==1L, totals$source_time[!known]=='2024-04-26 12:24:32.859703')
actual <- utc(totals$observed_at)
expected <- rep(NA_real_,nrow(totals))
for (zone in c('UTC','America/Chicago')) {
  use <- totals$zone==zone & known
  values <- gsub('T',' ',sub('Z$','',totals$source_time[use]),fixed=TRUE)
  expected[use] <- clock(values,zone)
}
numeric_rows <- which(totals$method=='original-POSIXct-epoch')
stopifnot(length(numeric_rows)==1567L)
for (i in numeric_rows) {
  env <- new.env(parent=emptyenv())
  names <- load(totals$original_path[i],envir=env)
  stopifnot(identical(names,'events_detail'))
  value <- unique(get('events_detail',envir=env)$time)
  stopifnot(inherits(value,'POSIXct'),length(value)==1L)
  expected[i] <- as.numeric(value)
}
stopifnot(all(is.finite(expected[known])),all(abs(actual[known]-expected[known])<=0.000001))
stopifnot(all(diff(actual[known])>0))
grids <- read_projection('grids')
stopifnot(all(grids$observed_at!=''))
grid_actual <- utc(grids$observed_at)
grid_expected <- rep(NA_real_,nrow(grids))
paired <- grids$method=='paired-original-RData'
link <- match(grids$related_total,totals$source_time)
stopifnot(all(!is.na(link)))
grid_expected[paired] <- actual[link[paired]]
filenames <- !paired
stopifnot(all(grids$method[filenames]=='UTC-filename-with-total-anchor'))
wall <- paste(substr(grids$source_time[filenames],1,10),gsub('_',':',substring(grids$source_time[filenames],12)))
grid_expected[filenames] <- clock(wall,'UTC')
stopifnot(all(abs(grid_expected[filenames]-actual[link[filenames]])<=1.000001))
stopifnot(all(abs(grid_actual-grid_expected)<=0.000001))
stopifnot(all(diff(grid_actual)>=0))
result <- data.frame(kind=c('totals','grids'),records=c(nrow(totals),nrow(grids)),
  resolved=c(sum(known),nrow(grids)),verified=TRUE)
write.csv(result,file.path(directory,'r-results.csv'),row.names=FALSE)
print(result,row.names=FALSE)
